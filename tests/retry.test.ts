/**
 * @file tests/retry.test.ts
 * @desc 429/503 retries: Retry-After seconds, dates and absence, the maxWaitMs cap, 5xx on GET
 *       only, the budget asked per retry, retry: false, attempts on the error.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sun Oct 11, 2026
 * @modified Sun Oct 11, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsuClient, OsuApiError } from "../src/index.js";

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const USER_URL = "https://osu.ppy.sh/api/v2/users/:user";
const PEPPY = { id: 2, username: "peppy", avatar_url: null, country_code: "AU" };

let answers: Array<() => Response> = [];
let calls = 0;
let tokens = 0;
let slept: number[] = [];

const server = setupServer(
  http.post(TOKEN_URL, () => {
    tokens += 1;
    return HttpResponse.json({ expires_in: 86400, access_token: `t${tokens}` });
  }),
  http.get(USER_URL, () => {
    calls += 1;
    const next = answers.shift();
    return next ? next() : HttpResponse.json(PEPPY);
  }),
);

// Whole seconds, so an HTTP date (second precision) round-trips exactly.
const NOW = Date.UTC(2026, 9, 11);
const client = (extra: Record<string, unknown> = {}) =>
  createOsuClient({
    credentials: { clientId: "1", clientSecret: "s" },
    userAgent: "test",
    now: () => NOW,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    ...extra,
  });
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new HttpResponse(null, { status: code, headers });

beforeAll(() => server.listen());
beforeEach(() => {
  answers = [];
  calls = 0;
  tokens = 0;
  slept = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("retries", () => {
  it("waits Retry-After seconds then succeeds", async () => {
    answers = [status(429, { "retry-after": "3" })];
    await expect(client().getUser(2)).resolves.toMatchObject({ osuId: 2 });
    expect(slept).toEqual([3000]);
    expect(calls).toBe(2);
  });

  it("reads an HTTP date, and a past date waits 0", async () => {
    answers = [
      status(429, { "retry-after": new Date(NOW + 2000).toUTCString() }),
      status(429, { "retry-after": new Date(NOW - 5000).toUTCString() }),
    ];
    await client().getUser(2);
    expect(slept).toEqual([2000, 0]);
  });

  it("backs off 1s then 2s with jitter when Retry-After is missing", async () => {
    answers = [status(503), status(503)];
    await client().getUser(2);
    expect(slept[0]).toBeGreaterThanOrEqual(1000);
    expect(slept[0]).toBeLessThanOrEqual(1250);
    expect(slept[1]).toBeGreaterThanOrEqual(2000);
    expect(slept[1]).toBeLessThanOrEqual(2500);
  });

  it("throws with attempts after the last retry", async () => {
    answers = [status(429), status(429), status(429)];
    const err = await client()
      .getUser(2)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsuApiError);
    expect(err).toMatchObject({ code: "http_error", status: 429, attempts: 3 });
  });

  it("throws at once when the wait is over maxWaitMs", async () => {
    answers = [status(429, { "retry-after": "30" })];
    const err = await client({ retry: { maxWaitMs: 5000 } })
      .getUser(2)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 30000, attempts: 1 });
    expect(slept).toEqual([]);
  });

  it("caps the total wait across retries at maxWaitMs", async () => {
    answers = [status(429, { "retry-after": "6" }), status(429, { "retry-after": "6" })];
    const err = await client()
      .getUser(2)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 6000, attempts: 2 });
    expect(slept).toEqual([6000]);
  });

  it("retries other 5xx once on GET, never 4xx", async () => {
    answers = [status(500), status(500)];
    await expect(client().getUser(2)).rejects.toMatchObject({ status: 500, attempts: 2 });
    answers = [status(400)];
    await expect(client().getUser(2)).rejects.toMatchObject({ status: 400, attempts: 1 });
  });

  it("asks the budget before each retry", async () => {
    answers = [status(429, { "retry-after": "1" })];
    let asked = 0;
    const beforeCall = async () => ++asked < 2;
    await expect(client().getUser(2, { beforeCall })).rejects.toMatchObject({ code: "budget" });
    expect(asked).toBe(2);
    expect(calls).toBe(1);
  });

  it("retry: false behaves like 0.9", async () => {
    answers = [status(429, { "retry-after": "1" })];
    await expect(client({ retry: false }).getUser(2)).rejects.toMatchObject({
      status: 429,
      attempts: 1,
    });
    expect(slept).toEqual([]);
  });

  it("does not request a new token on 429", async () => {
    answers = [status(429, { "retry-after": "1" }), status(429, { "retry-after": "1" })];
    const c = client();
    await Promise.all([c.getUser(2), c.getUser(2)]);
    expect(tokens).toBe(1);
  });
});
