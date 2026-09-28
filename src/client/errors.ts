/**
 * @file src/client/errors.ts
 * @desc OsuApiError, the one error type for a failure talking to osu!, and the Retry-After parser
 *       that fills its retryAfterMs.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Mon Sep 28, 2026
 */

/** Retry-After values past this are capped. */
const MAX_RETRY_AFTER_MS = 60_000;
/** An HTTP date in the IMF-fixdate form servers send (RFC 9110): Tue, 22 Sep 2026 12:00:03 GMT. */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * What went wrong: "timeout" (no answer in timeoutMs, headers or body), "network" (osu! couldn't
 * be reached), "bad_response" (a body that isn't JSON or isn't the expected shape), "http_error"
 * (osu! answered an error status), or "budget" (getStarRating's or getUser's beforeCall refused). Branch on the
 * ones you know; later versions may add codes.
 */
export type OsuApiErrorCode =
  | "timeout"
  | "network"
  | "bad_response"
  | "http_error"
  | "budget"
  | (string & {});

/**
 * A failure talking to osu!: a timeout, a network error, a body we couldn't read, an error status,
 * or a refused budget. Branch on `code`; `status` and `retryAfterMs` say more when osu! answered.
 */
export class OsuApiError extends Error {
  readonly code: OsuApiErrorCode;
  /** The HTTP status osu! answered, or null when there was none (network failure, timeout, budget). */
  readonly status: number | null;
  /** osu!'s Retry-After on a 429 or 503, in ms (capped at 60 s), when it sent a readable one. */
  readonly retryAfterMs: number | null;

  /**
   * @param code {OsuApiErrorCode} what went wrong
   * @param message {string} a sentence for logs; never holds a credential
   * @param options {{ status?, retryAfterMs?, cause? }} the HTTP status and Retry-After in ms
   *        (both null when not given), and the underlying error
   */
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

/**
 * @function parseRetryAfter
 * @param header {string | null} Retry-After value: delta-seconds or an IMF-fixdate HTTP date
 * @param now {number} current time in ms
 * @returns {number | null} the wait in ms, clamped to [0, 60 s]; null when absent or in any other
 *          form (Date.parse alone would read "1.5" or "-5" as a past date, so 0). Same parsing as
 *          @haruhimemoe/hinai
 */
export const parseRetryAfter = (header: string | null, now: number): number | null => {
  if (header === null) return null;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  if (!IMF_FIXDATE.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
};
