/**
 * @file src/client/token.ts
 * @desc The client-credentials token (scope public): requested on first use, shared by concurrent
 *       calls, cached until a minute before it expires (half its lifetime, for a token that lives
 *       under two minutes), and dropped once after a 401. Concurrent 401s share one refresh.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { z } from "zod";
import { OsuApiError, parseRetryAfter } from "./errors.js";
import { markAttempts, release, type Transport } from "./http.js";
import type { ClientSettings } from "./options.js";

/** Refresh this long before expiry so a token never dies mid-request. */
const TOKEN_EARLY_REFRESH_MS = 60_000;

/** A cached token and when to stop using it. Compared by identity after a 401. */
type Token = { value: string; refreshAt: number };

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/** An app-authorized request's method (GET by default), JSON body and extra headers. */
export type AuthorizedInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Asked before each retry (pass the call's beforeCall); false stops with a "budget" error. */
  beforeRetry?: () => Promise<boolean>;
};

/** Statuses retried on any method: osu! is rate limiting or briefly down. */
const BUSY = new Set([429, 503]);
/** Waits when osu! sends no Retry-After, by retry number, before jitter (up to +25%). */
const BACKOFF_MS = [1000, 2000, 4000, 4000, 4000];

/**
 * @function createAuthorizer
 * @param settings {ClientSettings} base URL, User-Agent, credentials and clock
 * @param transport {Transport} how requests are sent and answers read
 * @returns {(url: string | URL, init?: AuthorizedInit) => Promise<Response>} sends a request with
 *          the app's token; after a 401 it drops that token (unless another call already has)
 *          and tries once more
 */
export const createAuthorizer = (settings: ClientSettings, transport: Transport) => {
  const { baseUrl, userAgent, now, readCredentials } = settings;
  let token: Token | null = null;
  let pending: Promise<Token> | null = null;

  const requestToken = async (): Promise<Token> => {
    const { clientId, clientSecret } = readCredentials();
    const response = await transport.call(`${baseUrl}/oauth/token`, {
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
      return transport.failFor(response, `osu! token request failed (${response.status}).`);
    }
    const body = await transport.readJson(response);
    const parsed = transport.readAs(tokenResponseSchema, body, response.status);
    const lifetimeMs = parsed.expires_in * 1000;
    // A short-lived token is still reused for half its life, not refreshed on every call.
    const margin = Math.min(TOKEN_EARLY_REFRESH_MS, lifetimeMs / 2);
    token = { value: parsed.access_token, refreshAt: now() + lifetimeMs - margin };
    return token;
  };

  const getToken = (): Promise<Token> => {
    if (token && token.refreshAt > now()) return Promise.resolve(token);
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  };

  return async (url: string | URL, init: AuthorizedInit = {}): Promise<Response> => {
    const send = async (): Promise<[Response, Token]> => {
      const used = await getToken();
      const response = await transport.call(url, {
        method: init.method ?? "GET",
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          ...init.headers,
          Authorization: `Bearer ${used.value}`,
          Accept: "application/json",
          "User-Agent": userAgent,
        },
      });
      return [response, used];
    };
    const once = async (): Promise<Response> => {
      const [response, used] = await send();
      if (response.status !== 401) return response;
      release(response);
      // Drop only the token osu! refused: when another call's 401 already brought a fresh one (or
      // is fetching it), this retry shares that instead of asking for yet another.
      if (token === used) token = null;
      return (await send())[0];
    };
    const method = init.method ?? "GET";
    let attempts = 1;
    let serverRetried = false;
    let waited = 0;
    let response = await once();
    while (attempts <= settings.retry.attempts) {
      const { status } = response;
      const busy = BUSY.has(status);
      const flaky = !busy && status >= 500 && method === "GET" && !serverRetried;
      if (!busy && !flaky) break;
      const header = busy ? parseRetryAfter(response.headers.get("retry-after"), now()) : null;
      const backoff = BACKOFF_MS[attempts - 1] ?? 4000;
      const wait = header ?? Math.round(backoff * (1 + Math.random() * 0.25));
      // maxWaitMs caps the total sleep across retries, so a call never waits past it. Too long:
      // hand the answer back so failFor reports its Retry-After.
      if (waited + wait > settings.retry.maxWaitMs) break;
      waited += wait;
      release(response);
      if (init.beforeRetry && !(await init.beforeRetry())) {
        throw new OsuApiError("budget", "beforeCall refused the osu! call.", { attempts });
      }
      await settings.sleep(wait);
      if (flaky) serverRetried = true;
      response = await once();
      attempts += 1;
    }
    markAttempts(response, attempts);
    return response;
  };
};
