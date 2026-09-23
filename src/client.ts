/**
 * @file src/client.ts
 * @desc osu! API v2 client for servers (client credentials, scope public): beatmap metadata,
 *       beatmapsets with their content fields (with a capped /beatmapsets/{id} fallback for
 *       compact ones), and star ratings with mods. The token is cached and refreshed a minute
 *       early, and a 401 gets one retry with a fresh token. Every request sends your User-Agent
 *       and gives up after timeoutMs. Every failure talking to osu! is an OsuApiError with a code
 *       and, for a 429 or 503, osu!'s Retry-After. Keep the client secret on the server.
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
/** The longest delay setTimeout (and so AbortSignal.timeout) takes. */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Retry-After values past this are capped. */
const MAX_RETRY_AFTER_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const beatmapsResponseSchema = z.object({ beatmaps: z.array(z.unknown()) });
const attributesResponseSchema = z.object({
  attributes: z.object({ star_rating: z.number().nonnegative() }),
});

/**
 * What went wrong: "timeout" (no answer in timeoutMs, headers or body), "network" (osu! couldn't
 * be reached), "bad_response" (a body that isn't JSON or isn't the expected shape), "http_error"
 * (osu! answered an error status), or "budget" (getStarRating's beforeCall refused). Branch on the
 * ones you know; later versions may add codes.
 */
export type OsuApiErrorCode =
  | "timeout"
  | "network"
  | "bad_response"
  | "http_error"
  | "budget"
  | (string & {});

export class OsuApiError extends Error {
  readonly code: OsuApiErrorCode;
  /** The HTTP status osu! answered, or null when there was none (network failure, timeout, budget). */
  readonly status: number | null;
  /** osu!'s Retry-After on a 429 or 503, in ms (capped at 60 s), when it sent a readable one. */
  readonly retryAfterMs: number | null;

  constructor(
    code: OsuApiErrorCode,
    message: string,
    options: {
      status?: number | null | undefined;
      retryAfterMs?: number | null | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OsuApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export type OsuCredentials = { clientId: string; clientSecret: string };

export type OsuClientOptions = {
  /**
   * The OAuth app's id and secret (non-empty strings), or a function returning them. A function is
   * called on every token request (the first call, each refresh, and after a 401), never at import,
   * so a rotated secret is picked up. Its errors reach you unchanged.
   */
  credentials: OsuCredentials | (() => OsuCredentials);
  /** Sent on every request, e.g. "my-tool (+https://example.com; me@example.com)". */
  userAgent: string;
  /**
   * Default https://osu.ppy.sh. Token requests go here too, so this server receives your client
   * secret: point it only at osu! itself or your own test server, never at a mirror. Must be
   * https, or http on localhost / 127.0.0.1.
   */
  baseUrl?: string | undefined;
  /**
   * How long one request (answer and body) may take before it fails. An integer from 1 to
   * 2_147_483_647. Default OSU_TIMEOUT_MS (10 s).
   */
  timeoutMs?: number | undefined;
  fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  /** Clock for token expiry (tests). */
  now?: (() => number) | undefined;
};

/**
 * Difficulties osu! knows (`found`), ids it doesn't (`missing`), and ids we couldn't check
 * (`unchecked`: beforeCall refused their batch, or osu!'s row for them failed the schema).
 */
export type BeatmapLookup = {
  found: Map<number, BeatmapMeta>;
  missing: number[];
  unchecked: number[];
};

export type BeatmapOptions = {
  /**
   * Your rate budget: asked before each planned osu! API call; false skips that call. Not asked
   * for token requests or for the one retry after a 401. Default: always call (unlimited). Its
   * errors reach you unchanged.
   */
  beforeCall?: (() => Promise<boolean>) | undefined;
};

/** Options for getStarRating. */
export type StarRatingOptions = BeatmapOptions;

/**
 * Beatmapsets plus ids left unchecked (see getBeatmapsets for exactly when). Ids osu! doesn't know
 * are in neither.
 */
export type BeatmapsetLookup = {
  /** Keyed by beatmap (difficulty) id, not set id; sibling difficulties share one set object. */
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
/** Just the id of a /beatmaps row, to file a row that fails the full schema. */
const rowIdSchema = z.object({ id: z.number() });
const isTimeout = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === "TimeoutError";
const isLocalHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1";
const isFilled = (value: unknown): value is string => typeof value === "string" && !!value.trim();

/**
 * Reads the credentials, refusing anything but two non-empty strings. The message names the field,
 * never its value.
 */
const checkCredentials = (value: OsuCredentials): OsuCredentials => {
  for (const field of ["clientId", "clientSecret"] as const) {
    if (!isFilled(value?.[field])) {
      throw new TypeError(`osu! credentials need a non-empty ${field} string.`);
    }
  }
  return value;
};

/**
 * Retry-After as ms (delta-seconds or an HTTP date), capped at MAX_RETRY_AFTER_MS; null when
 * absent or unreadable. Same parsing as @haruhimemoe/hinai.
 */
const parseRetryAfter = (header: string | null, now: number): number | null => {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
};

/** The base URL without trailing slashes, or a RangeError when it could leak the secret. */
const checkBaseUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("baseUrl must be an absolute URL.");
  }
  const local = url.protocol === "http:" && isLocalHost(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new RangeError(
      "baseUrl gets your client secret, so it must be https (or http on localhost).",
    );
  }
  return value.replace(/\/+$/, "");
};
// Control characters (CR, LF, NUL, …) can't go in a header.
// biome-ignore lint/suspicious/noControlCharactersInRegex: that's the point of this pattern.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * @function createOsuClient
 * @param options {OsuClientOptions} credentials, User-Agent, and optional base URL, timeout,
 *        fetch and clock
 * @returns {{ getBeatmaps, getBeatmapsets, getStarRating }} the client; create one per process
 *          and reuse it so the token is shared
 * @throws {TypeError} when userAgent is empty or has control characters, or credentials given as
 *         an object aren't two non-empty strings
 * @throws {RangeError} when timeoutMs isn't an integer from 1 to 2_147_483_647, or baseUrl isn't
 *         an https URL (or http on localhost / 127.0.0.1)
 */
export const createOsuClient = (options: OsuClientOptions) => {
  const { credentials, userAgent } = options;
  const timeoutMs = options.timeoutMs ?? OSU_TIMEOUT_MS;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  if (!userAgent.trim() || CONTROL.test(userAgent)) {
    throw new TypeError("createOsuClient needs a userAgent naming your app, on one line.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError("timeoutMs must be an integer from 1 to 2147483647.");
  }
  const baseUrl = checkBaseUrl(options.baseUrl ?? OSU_BASE_URL);
  if (typeof credentials !== "function") checkCredentials(credentials);
  const readCredentials = () =>
    checkCredentials(typeof credentials === "function" ? credentials() : credentials);
  let token: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  /** fetch with the timeout, turning a network failure or timeout into an OsuApiError. */
  const call = async (url: string | URL, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      if (isTimeout(cause)) {
        throw new OsuApiError("timeout", `osu! didn't answer in time (${timeoutMs} ms).`, {
          cause,
        });
      }
      throw new OsuApiError("network", "Couldn't reach osu!.", { cause });
    }
  };

  /**
   * A response's JSON, or an OsuApiError carrying its status: "timeout" when timeoutMs ran out
   * during the body, else "bad_response".
   */
  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch (cause) {
      const { status } = response;
      if (isTimeout(cause)) {
        throw new OsuApiError(
          "timeout",
          `osu! didn't finish answering in time (${timeoutMs} ms).`,
          {
            status,
            cause,
          },
        );
      }
      throw new OsuApiError("bad_response", "osu! sent a response we couldn't read.", {
        status,
        cause,
      });
    }
  };

  /** Validates a body, or throws a "bad_response" OsuApiError carrying the response's status. */
  const readAs = <T>(schema: z.ZodType<T>, body: unknown, status: number): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OsuApiError("bad_response", "osu! sent a response we couldn't read.", {
        status,
        cause: parsed.error,
      });
    }
    return parsed.data;
  };

  /** Throws an "http_error" for a non-OK response (with Retry-After on 429/503), releasing it. */
  const failFor = (response: Response, message: string): never => {
    release(response);
    const { status } = response;
    const retryAfterMs =
      status === 429 || status === 503
        ? parseRetryAfter(response.headers.get("retry-after"), now())
        : null;
    throw new OsuApiError("http_error", message, { status, retryAfterMs });
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
      // Only osu!'s own failures are "unchecked"; a credentials problem is the caller's to see.
      if (!(error instanceof OsuApiError)) throw error;
      return error.status === 404 ? "missing" : "unchecked";
    }
  };

  /**
   * Files one /beatmaps batch's rows: `accept` gets each row that parses and was asked for. The ids
   * of rows that fail the schema are returned, and so is every id the batch has no good row for
   * when some row's id can't even be read (we can't tell which id it was).
   */
  const fileRows = <T extends { id: number }>(
    rows: readonly unknown[],
    batch: readonly number[],
    schema: z.ZodType<T>,
    accept: (row: T) => void,
  ): number[] => {
    const asked = new Set(batch);
    const good = new Set<number>();
    const bad = new Set<number>();
    let unreadable = false;
    for (const row of rows) {
      const parsed = schema.safeParse(row);
      if (parsed.success) {
        if (!asked.has(parsed.data.id)) continue;
        good.add(parsed.data.id);
        accept(parsed.data);
        continue;
      }
      const id = rowIdSchema.safeParse(row);
      if (!id.success) unreadable = true;
      else if (asked.has(id.data.id)) bad.add(id.data.id);
    }
    return batch.filter((id) => !good.has(id) && (unreadable || bad.has(id)));
  };

  return {
    /**
     * @function getBeatmaps
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and comes back missing)
     * @param options {BeatmapOptions} beforeCall, asked before each /beatmaps call (your budget)
     * @returns {Promise<BeatmapLookup>} 50 ids per request. `found`: metadata by id. `missing`:
     *          invalid ids, and ids osu! answered no row for. `unchecked`: ids in batches
     *          beforeCall refused, ids whose row failed the schema, and every unanswered id of a
     *          batch holding a row without a readable id
     * @throws {OsuApiError} when the token request fails, a /beatmaps call answers an error
     *         status (after the one 401 retry) or a body that isn't `{ beatmaps: [...] }`, times
     *         out, or can't reach osu!; the whole call fails, earlier batches included
     * @throws {TypeError} when the credentials aren't two non-empty strings
     */
    async getBeatmaps(
      ids: readonly number[],
      { beforeCall = alwaysCall }: BeatmapOptions = {},
    ): Promise<BeatmapLookup> {
      const unique = [...new Set(ids)];
      const valid = unique.filter(isId);
      const found = new Map<number, BeatmapMeta>();
      const unchecked: number[] = [];
      for (let i = 0; i < valid.length; i += OSU_BEATMAPS_BATCH_LIMIT) {
        const batch = valid.slice(i, i + OSU_BEATMAPS_BATCH_LIMIT);
        if (!(await beforeCall())) {
          unchecked.push(...batch);
          continue;
        }
        const rows = await fetchBatch(batch);
        unchecked.push(
          ...fileRows(rows, batch, osuBeatmapRowSchema, (row) => {
            found.set(row.id, toBeatmapMeta(row));
          }),
        );
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
     * @returns {Promise<BeatmapsetLookup>} each known id's extended beatmapset, and as unchecked:
     *          ids in /beatmaps batches beforeCall refused; ids whose row failed the schema (every
     *          unanswered id of the batch when a row's id can't be read); and ids whose set came
     *          compact and wasn't looked up (fallbackLimit spent, or beforeCall refused) or whose
     *          /beatmapsets/{id} lookup failed in any way but a 404 (error status, token failure,
     *          timeout, network, unreadable or still-compact body). A 404 means the set is gone:
     *          its ids are in neither, like ids osu! answered no row for
     * @throws {OsuApiError} when the token request before a /beatmaps call fails, or a /beatmaps
     *         call answers an error status (after the one 401 retry) or a body that isn't
     *         `{ beatmaps: [...] }`, times out, or can't reach osu!; the whole call fails
     * @throws {TypeError} when the credentials aren't two non-empty strings
     * @throws {RangeError} when fallbackLimit isn't a non-negative integer (before any call)
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
      const setOf = new Map<number, number>();
      const sets = new Map<number, OsuBeatmapset>();
      const unchecked: number[] = [];
      for (let i = 0; i < unique.length; i += OSU_BEATMAPS_BATCH_LIMIT) {
        const batch = unique.slice(i, i + OSU_BEATMAPS_BATCH_LIMIT);
        if (!(await beforeCall())) {
          unchecked.push(...batch);
          continue;
        }
        const rows = await fetchBatch(batch);
        unchecked.push(
          ...fileRows(rows, batch, osuBeatmapsetRowSchema, (row) => {
            setOf.set(row.id, row.beatmapset_id);
            if (!sets.has(row.beatmapset_id)) sets.set(row.beatmapset_id, row.beatmapset);
          }),
        );
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
     * @param options {StarRatingOptions} beforeCall, asked once before the call (your budget)
     * @returns {Promise<number | null>} osu!'s current star rating with those mods, or null when
     *          osu! has no such map or won't rate those mods (404/422)
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token,
     *         a rate limit, a server error, an unreadable body, a timeout, or a network failure
     * @throws {TypeError} when the credentials aren't two non-empty strings
     * @throws {RangeError} when beatmapId isn't a positive integer
     */
    async getStarRating(
      beatmapId: number,
      mods: readonly string[],
      { beforeCall = alwaysCall }: StarRatingOptions = {},
    ): Promise<number | null> {
      if (!isId(beatmapId)) throw new RangeError("beatmapId must be a positive integer.");
      if (!(await beforeCall())) {
        throw new OsuApiError("budget", "beforeCall refused the osu! call.");
      }
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
