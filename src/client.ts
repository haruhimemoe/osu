/**
 * @file src/client.ts
 * @desc osu! API v2 client for servers (client credentials, scope public): beatmap metadata,
 *       beatmapsets with their content fields (with a capped /beatmapsets/{id} fallback for
 *       compact ones), and star ratings with mods. The token is cached and refreshed a minute
 *       early, and a 401 gets one retry with a fresh token. Every request sends your User-Agent
 *       and gives up after timeoutMs. Every failure is an OsuApiError. Keep the client secret on
 *       the server.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";
import { type BeatmapMeta, osuBeatmapRowSchema, toBeatmapMeta } from "./shapes/beatmap.js";
import {
  isExtendedBeatmapset,
  type OsuBeatmapset,
  type OsuBeatmapsetExtended,
  osuBeatmapsetRowSchema,
  osuBeatmapsetSchema,
} from "./shapes/beatmapset.js";
import { OSU_BASE_URL } from "./shapes/links.js";

/** osu! answers at most this many ids per GET /api/v2/beatmaps. */
export const OSU_BEATMAPS_BATCH_LIMIT = 50;
/** Default cap on /beatmapsets/{id} fallback calls per getBeatmapsets call. */
export const BEATMAPSET_FALLBACK_LIMIT = 10;
/** Default time a single request may take. */
export const OSU_TIMEOUT_MS = 10_000;
/** Refresh this long before expiry so a token never dies mid-request. */
const TOKEN_EARLY_REFRESH_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const beatmapsResponseSchema = z.object({ beatmaps: z.array(z.unknown()) });
const attributesResponseSchema = z.object({
  attributes: z.object({ star_rating: z.number().nonnegative() }),
});

export class OsuApiError extends Error {
  /** The HTTP status osu! answered, or null when there was none (network failure, timeout). */
  readonly status: number | null;

  constructor(message: string, status: number | null = null, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "OsuApiError";
    this.status = status;
  }
}

export type OsuCredentials = { clientId: string; clientSecret: string };

export type OsuClientOptions = {
  /** The OAuth app's id and secret, or a function returning them (read lazily, on first use). */
  credentials: OsuCredentials | (() => OsuCredentials);
  /** Sent on every request, e.g. "my-tool (+https://example.com; me@example.com)". */
  userAgent: string;
  /** Default https://osu.ppy.sh. */
  baseUrl?: string | undefined;
  /** How long one request may take before it fails. Default OSU_TIMEOUT_MS (10 s). */
  timeoutMs?: number | undefined;
  fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  /** Clock for token expiry (tests). */
  now?: (() => number) | undefined;
};

/** Difficulties osu! knows (`found`), ids it doesn't (`missing`), and ids not asked (`unchecked`). */
export type BeatmapLookup = {
  found: Map<number, BeatmapMeta>;
  missing: number[];
  unchecked: number[];
};

export type BeatmapOptions = {
  /** Asked before every osu! API call (not the token request); false skips that call. */
  beforeCall?: (() => Promise<boolean>) | undefined;
};

/**
 * Beatmapsets by beatmap id (siblings share one object), plus ids left unchecked: their set wasn't
 * looked up because the fallback cap ran out or beforeCall refused the call that would have
 * covered them, or its lookup failed. Ids osu! doesn't know are in neither.
 */
export type BeatmapsetLookup = {
  sets: Map<number, OsuBeatmapsetExtended>;
  unchecked: number[];
};

export type BeatmapsetOptions = BeatmapOptions & {
  /** At most this many /beatmapsets/{id} fallback calls. Default BEATMAPSET_FALLBACK_LIMIT (10). */
  fallbackLimit?: number | undefined;
};

const alwaysCall = async (): Promise<boolean> => true;
/** Frees the connection behind a body we won't read. Not awaited: a cancel can hang on some stubs. */
const release = (response: Response): void => {
  response.body?.cancel().catch(() => undefined);
};
const isId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;
// Control characters (CR, LF, NUL, …) can't go in a header.
// biome-ignore lint/suspicious/noControlCharactersInRegex: that's the point of this pattern.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * @function createOsuClient
 * @param options {OsuClientOptions} credentials, User-Agent, and optional base URL, timeout,
 *        fetch and clock
 * @returns {{ getBeatmaps, getBeatmapsets, getStarRating }} the client; create one per process
 *          and reuse it so the token is shared
 * @throws {TypeError} when userAgent is empty or has control characters
 * @throws {RangeError} when timeoutMs isn't a positive number
 */
export const createOsuClient = (options: OsuClientOptions) => {
  const { credentials, userAgent } = options;
  const baseUrl = (options.baseUrl ?? OSU_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? OSU_TIMEOUT_MS;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  if (!userAgent.trim() || CONTROL.test(userAgent)) {
    throw new TypeError("createOsuClient needs a userAgent naming your app, on one line.");
  }
  if (!(timeoutMs > 0)) throw new RangeError("timeoutMs must be a positive number.");
  const readCredentials = () => (typeof credentials === "function" ? credentials() : credentials);
  let token: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  /** fetch with the timeout, turning a network failure or timeout into an OsuApiError. */
  const call = async (url: string | URL, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      throw new OsuApiError(
        timedOut ? `osu! didn't answer in time (${timeoutMs} ms).` : "Couldn't reach osu!.",
        null,
        { cause },
      );
    }
  };

  /** A response's JSON, or an OsuApiError carrying its status when the body isn't JSON. */
  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch (cause) {
      throw new OsuApiError("osu! sent a response we couldn't read.", response.status, { cause });
    }
  };

  /** Validates a body, or throws an OsuApiError carrying the response's status. */
  const readAs = <T>(schema: z.ZodType<T>, body: unknown, status: number): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OsuApiError("osu! sent a response we couldn't read.", status, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  };

  /** Throws for a non-OK response, releasing its body first. */
  const failFor = (response: Response, message: string): never => {
    release(response);
    throw new OsuApiError(message, response.status);
  };

  const requestToken = async (): Promise<string> => {
    const { clientId, clientSecret } = readCredentials();
    const response = await call(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "public",
      }),
    });
    if (!response.ok) {
      return failFor(response, `osu! token request failed (${response.status}).`);
    }
    const parsed = readAs(tokenResponseSchema, await readJson(response), response.status);
    token = { value: parsed.access_token, expiresAt: now() + parsed.expires_in * 1000 };
    return token.value;
  };

  const getToken = (): Promise<string> => {
    if (token && token.expiresAt - TOKEN_EARLY_REFRESH_MS > now()) {
      return Promise.resolve(token.value);
    }
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  };

  /** Sends an app-authorized request; after a 401 it drops the token and tries once more. */
  const authorized = async (
    url: string | URL,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    const send = async () =>
      call(url, {
        method: init.method ?? "GET",
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          ...init.headers,
          Authorization: `Bearer ${await getToken()}`,
          Accept: "application/json",
          "User-Agent": userAgent,
        },
      });
    let response = await send();
    if (response.status === 401) {
      release(response);
      token = null;
      response = await send();
    }
    return response;
  };

  const getJson = async (url: URL): Promise<{ body: unknown; status: number }> => {
    const response = await authorized(url);
    if (!response.ok) return failFor(response, `osu! answered ${response.status}.`);
    return { body: await readJson(response), status: response.status };
  };

  const fetchBatch = async (ids: readonly number[]): Promise<unknown[]> => {
    const url = new URL(`${baseUrl}/api/v2/beatmaps`);
    for (const id of ids) url.searchParams.append("ids[]", String(id));
    const { body, status } = await getJson(url);
    return readAs(beatmapsResponseSchema, body, status).beatmaps;
  };

  /**
   * The full set, for a /beatmaps row whose beatmapset was compact: the extended set, "missing"
   * when osu! answers 404, or "unchecked" on anything else (429, 5xx, a body we can't read, a
   * set that's still compact), so one bad lookup never throws away what the call already has.
   */
  const fetchBeatmapset = async (
    setId: number,
  ): Promise<OsuBeatmapsetExtended | "missing" | "unchecked"> => {
    try {
      const { body } = await getJson(new URL(`${baseUrl}/api/v2/beatmapsets/${setId}`));
      const parsed = osuBeatmapsetSchema.safeParse(body);
      return parsed.success && isExtendedBeatmapset(parsed.data) ? parsed.data : "unchecked";
    } catch (error) {
      return error instanceof OsuApiError && error.status === 404 ? "missing" : "unchecked";
    }
  };

  return {
    /**
     * @function getBeatmaps
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and comes back missing)
     * @param options {BeatmapOptions} beforeCall, asked before each /beatmaps call (your budget)
     * @returns {Promise<BeatmapLookup>} metadata by id for the ids osu! knows, the ids it doesn't,
     *          and the ids in batches beforeCall refused; 50 ids per request
     * @throws {OsuApiError} when osu! refuses the token or a lookup, or can't be reached
     */
    async getBeatmaps(
      ids: readonly number[],
      { beforeCall = alwaysCall }: BeatmapOptions = {},
    ): Promise<BeatmapLookup> {
      const unique = [...new Set(ids)];
      const valid = unique.filter(isId);
      const wanted = new Set(valid);
      const found = new Map<number, BeatmapMeta>();
      const unchecked: number[] = [];
      for (let i = 0; i < valid.length; i += OSU_BEATMAPS_BATCH_LIMIT) {
        const batch = valid.slice(i, i + OSU_BEATMAPS_BATCH_LIMIT);
        if (!(await beforeCall())) {
          unchecked.push(...batch);
          continue;
        }
        for (const row of await fetchBatch(batch)) {
          const parsed = osuBeatmapRowSchema.safeParse(row);
          if (parsed.success && wanted.has(parsed.data.id)) {
            found.set(parsed.data.id, toBeatmapMeta(parsed.data));
          }
        }
      }
      const skipped = new Set(unchecked);
      const missing = unique.filter((id) => !found.has(id) && !skipped.has(id));
      return { found, missing, unchecked };
    },

    /**
     * @function getBeatmapsets
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and is left out)
     * @param options {BeatmapsetOptions} beforeCall (your rate budget) and the fallback cap
     * @returns {Promise<BeatmapsetLookup>} each known id's extended beatmapset, and the ids left
     *          unchecked once the fallback cap is spent, beforeCall refused the call covering
     *          them, or their set's lookup failed (anything but a 404, which means the set is gone)
     * @throws {OsuApiError} when osu! refuses the token or a /beatmaps lookup, or can't be reached
     * @throws {RangeError} when fallbackLimit isn't a non-negative integer
     */
    async getBeatmapsets(
      ids: readonly number[],
      {
        beforeCall = alwaysCall,
        fallbackLimit = BEATMAPSET_FALLBACK_LIMIT,
      }: BeatmapsetOptions = {},
    ): Promise<BeatmapsetLookup> {
      if (!Number.isInteger(fallbackLimit) || fallbackLimit < 0) {
        throw new RangeError("fallbackLimit must be a non-negative integer.");
      }
      const unique = [...new Set(ids)].filter(isId);
      const wanted = new Set(unique);
      const setOf = new Map<number, number>();
      const sets = new Map<number, OsuBeatmapset>();
      const unchecked: number[] = [];
      for (let i = 0; i < unique.length; i += OSU_BEATMAPS_BATCH_LIMIT) {
        const batch = unique.slice(i, i + OSU_BEATMAPS_BATCH_LIMIT);
        if (!(await beforeCall())) {
          unchecked.push(...batch);
          continue;
        }
        for (const row of await fetchBatch(batch)) {
          const parsed = osuBeatmapsetRowSchema.safeParse(row);
          if (!parsed.success || !wanted.has(parsed.data.id)) continue;
          const setId = parsed.data.beatmapset_id;
          setOf.set(parsed.data.id, setId);
          if (!sets.has(setId)) sets.set(setId, parsed.data.beatmapset);
        }
      }
      // One extra call per compact set (osu!'s docs say /beatmaps sends extended sets), capped so a
      // bad /beatmaps answer can't spend the rate limit. The cap is checked first, so beforeCall
      // is only asked about calls that would really be made.
      let fallbacks = 0;
      const skipped = new Set<number>();
      for (const [setId, set] of sets) {
        if (isExtendedBeatmapset(set)) continue;
        if (fallbacks >= fallbackLimit || !(await beforeCall())) {
          skipped.add(setId);
          continue;
        }
        fallbacks += 1;
        const full = await fetchBeatmapset(setId);
        if (full === "missing") sets.delete(setId);
        else if (full === "unchecked") skipped.add(setId);
        else sets.set(setId, full);
      }
      const found = new Map<number, OsuBeatmapsetExtended>();
      for (const [id, setId] of setOf) {
        const set = sets.get(setId);
        if (set && isExtendedBeatmapset(set)) found.set(id, set);
        else if (skipped.has(setId)) unchecked.push(id);
      }
      return { sets: found, unchecked };
    },

    /**
     * @function getStarRating
     * @param beatmapId {number} difficulty id
     * @param mods {readonly string[]} mod acronyms, e.g. ["HD", "HR"] (no-mod ratings come with
     *        the metadata)
     * @returns {Promise<number | null>} osu!'s current star rating with those mods, or null when
     *          osu! has no such map or won't rate those mods (404/422)
     * @throws {OsuApiError} on a refused token, a rate limit, a server error, an unreadable body,
     *         a timeout, or a network failure
     * @throws {RangeError} when beatmapId isn't a positive integer
     */
    async getStarRating(beatmapId: number, mods: readonly string[]): Promise<number | null> {
      if (!isId(beatmapId)) throw new RangeError("beatmapId must be a positive integer.");
      const response = await authorized(`${baseUrl}/api/v2/beatmaps/${beatmapId}/attributes`, {
        method: "POST",
        body: JSON.stringify({ mods }),
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 404 || response.status === 422) {
        release(response);
        return null;
      }
      if (!response.ok) return failFor(response, `osu! answered ${response.status}.`);
      const body = await readJson(response);
      return readAs(attributesResponseSchema, body, response.status).attributes.star_rating;
    },
  };
};

export type OsuClient = ReturnType<typeof createOsuClient>;
