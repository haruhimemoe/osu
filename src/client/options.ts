/**
 * @file src/client/options.ts
 * @desc The client's limits and defaults, and the checks createOsuClient runs on its options before
 *       anything is sent. Messages name a field, never a credential's value.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { OSU_BASE_URL } from "../shapes/links.js";
import type { OsuClientOptions, OsuCredentials } from "./types.js";

/** osu! answers at most this many ids per GET /api/v2/beatmaps. */
export const OSU_BEATMAPS_BATCH_LIMIT = 50;
/** Default cap on /beatmapsets/{id} fallback calls per getBeatmapsets call. */
export const OSU_BEATMAPSET_FALLBACK_LIMIT = 10;
/** @deprecated Use OSU_BEATMAPSET_FALLBACK_LIMIT, the same value under its prefixed name. */
export const BEATMAPSET_FALLBACK_LIMIT = OSU_BEATMAPSET_FALLBACK_LIMIT;
/** Default time a single request may take. */
export const OSU_TIMEOUT_MS = 10_000;
/** The longest delay setTimeout (and so AbortSignal.timeout) takes. */
const MAX_TIMEOUT_MS = 2_147_483_647;
/**
 * A User-Agent we send: printable ASCII only. Control characters (CR, LF, NUL, …) can't go in a
 * header, and fetch refuses anything past U+00FF, which would fail every request as "network".
 */
const USER_AGENT = /^[\x20-\x7e]+$/;

/** createOsuClient's options, checked, with every default filled in. */
export type ClientSettings = {
  userAgent: string;
  baseUrl: string;
  timeoutMs: number;
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** Reads (or calls for) the credentials and checks them; called once per token request. */
  readCredentials: () => OsuCredentials;
};

/**
 * @function isId
 * @param id {number} a beatmap id from the caller
 * @returns {boolean} whether it's a positive safe integer, the only ids ever sent to osu!
 */
export const isId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;

const isFilled = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const isLocalHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1";

/** The credentials, or a TypeError naming the first field that isn't a non-empty string. */
const checkCredentials = (value: OsuCredentials): OsuCredentials => {
  for (const field of ["clientId", "clientSecret"] as const) {
    if (!isFilled(value?.[field])) {
      throw new TypeError(`osu! credentials need a non-empty ${field} string.`);
    }
  }
  return value;
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

/**
 * @function resolveOptions
 * @param options {OsuClientOptions} what the caller passed to createOsuClient
 * @returns {ClientSettings} the options, checked, with defaults filled in
 * @throws {TypeError} when userAgent is blank or holds anything but printable ASCII (a line
 *         break, a control character, an emoji), or credentials given as an object aren't two
 *         non-empty strings
 * @throws {RangeError} when timeoutMs isn't an integer from 1 to 2_147_483_647, or baseUrl isn't
 *         an https URL (or http on localhost / 127.0.0.1)
 */
export const resolveOptions = (options: OsuClientOptions): ClientSettings => {
  const { credentials, userAgent } = options;
  const timeoutMs = options.timeoutMs ?? OSU_TIMEOUT_MS;
  if (typeof userAgent !== "string" || !userAgent.trim() || !USER_AGENT.test(userAgent)) {
    throw new TypeError(
      "createOsuClient needs a userAgent naming your app, on one line, in printable ASCII.",
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError("timeoutMs must be an integer from 1 to 2147483647.");
  }
  const baseUrl = checkBaseUrl(options.baseUrl ?? OSU_BASE_URL);
  if (typeof credentials !== "function") checkCredentials(credentials);
  return {
    userAgent,
    baseUrl,
    timeoutMs,
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: options.now ?? Date.now,
    readCredentials: () =>
      checkCredentials(typeof credentials === "function" ? credentials() : credentials),
  };
};
