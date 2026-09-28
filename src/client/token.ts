/**
 * @file src/client/token.ts
 * @desc The client-credentials token (scope public): requested on first use, shared by concurrent
 *       calls, cached until a minute before it expires, and dropped once after a 401.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { z } from "zod";
import { release, type Transport } from "./http.js";
import type { ClientSettings } from "./options.js";

/** Refresh this long before expiry so a token never dies mid-request. */
const TOKEN_EARLY_REFRESH_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/** An app-authorized request: the method, a JSON body and extra headers (GET with none by default). */
export type AuthorizedInit = { method?: string; body?: string; headers?: Record<string, string> };

/**
 * @function createAuthorizer
 * @param settings {ClientSettings} base URL, User-Agent, credentials and clock
 * @param transport {Transport} how requests are sent and answers read
 * @returns {(url: string | URL, init?: AuthorizedInit) => Promise<Response>} sends a request with
 *          the app's token; after a 401 it drops the token and tries once more
 */
export const createAuthorizer = (settings: ClientSettings, transport: Transport) => {
  const { baseUrl, userAgent, now, readCredentials } = settings;
  let token: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  const requestToken = async (): Promise<string> => {
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

  return async (url: string | URL, init: AuthorizedInit = {}): Promise<Response> => {
    const send = async () =>
      transport.call(url, {
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
};
