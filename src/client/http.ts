/**
 * @file src/client/http.ts
 * @desc One request to osu! and reading its answer: fetch with the timeout, JSON bodies, schema
 *       checks and error statuses, each failure turned into an OsuApiError with a code.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import type { z } from "zod";
import { OsuApiError, parseRetryAfter } from "./errors.js";
import type { ClientSettings } from "./options.js";

/** What createTransport returns: the request and response helpers the client builds on. */
export type Transport = {
  /** fetch with the timeout, turning a network failure or timeout into an OsuApiError. */
  call: (url: string | URL, init: RequestInit) => Promise<Response>;
  /** A response's JSON; "timeout" when timeoutMs ran out during the body, else "bad_response". */
  readJson: (response: Response) => Promise<unknown>;
  /** Validates a body, or throws a "bad_response" OsuApiError carrying the response's status. */
  readAs: <T>(schema: z.ZodType<T>, body: unknown, status: number) => T;
  /** Throws an "http_error" for a non-OK response (with Retry-After on 429/503), releasing it. */
  failFor: (response: Response, message: string) => never;
};

const isTimeout = (cause: unknown): boolean =>
  cause instanceof DOMException && cause.name === "TimeoutError";

/**
 * @function release
 * @param response {Response} an answer whose body we won't read
 * @returns {void} frees the connection behind it. Not awaited: a cancel can hang on some stubs
 */
export const release = (response: Response): void => {
  response.body?.cancel().catch(() => undefined);
};

/**
 * @function createTransport
 * @param settings {Pick<ClientSettings, "fetch" | "timeoutMs" | "now">} the fetch to use, the
 *        per-request timeout, and the clock for Retry-After dates
 * @returns {Transport} call, readJson, readAs and failFor
 */
export const createTransport = ({
  fetch,
  timeoutMs,
  now,
}: Pick<ClientSettings, "fetch" | "timeoutMs" | "now">): Transport => ({
  async call(url, init) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      if (isTimeout(cause)) {
        throw new OsuApiError("timeout", `osu! didn't answer in time (${timeoutMs} ms).`, {
          cause,
        });
      }
      throw new OsuApiError("network", "Couldn't reach osu!.", { cause });
    }
  },

  async readJson(response) {
    try {
      return await response.json();
    } catch (cause) {
      const { status } = response;
      if (isTimeout(cause)) {
        throw new OsuApiError(
          "timeout",
          `osu! didn't finish answering in time (${timeoutMs} ms).`,
          { status, cause },
        );
      }
      throw new OsuApiError("bad_response", "osu! sent a response we couldn't read.", {
        status,
        cause,
      });
    }
  },

  readAs(schema, body, status) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OsuApiError("bad_response", "osu! sent a response we couldn't read.", {
        status,
        cause: parsed.error,
      });
    }
    return parsed.data;
  },

  failFor(response, message) {
    release(response);
    const { status } = response;
    const retryAfterMs =
      status === 429 || status === 503
        ? parseRetryAfter(response.headers.get("retry-after"), now())
        : null;
    throw new OsuApiError("http_error", message, { status, retryAfterMs });
  },
});
