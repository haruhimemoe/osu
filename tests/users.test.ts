/**
 * @file tests/users.test.ts
 * @desc User lookups: getUser by id (key=id) or name (@name), with a ruleset, null on 404, the
 *       budget, error statuses, a 401 retry and an unreadable body; getUsers in batches of 50 with
 *       found, missing and unchecked ids.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsuClient, OsuApiError } from "../src/index.js";

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const USER_URL = "https://osu.ppy.sh/api/v2/users/:user";
const USER_MODE_URL = "https://osu.ppy.sh/api/v2/users/:user/:mode";
const USERS_URL = "https://osu.ppy.sh/api/v2/users";

const PEPPY = { id: 2, username: "peppy", avatar_url: "https://a.ppy.sh/2", country_code: "AU" };
const people = new Map([[2, PEPPY]]);

let requests: URL[] = [];
let tokens = 0;

const server = setupServer(
  http.post(TOKEN_URL, () => {
    tokens += 1;
    return HttpResponse.json({ expires_in: 86400, access_token: `token-${tokens}` });
  }),
  http.get(USERS_URL, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    const ids = url.searchParams.getAll("ids[]").map(Number);
    return HttpResponse.json({
      users: ids.map((id) => people.get(id) ?? (id === 7 ? { id: 7 } : null)).filter(Boolean),
    });
  }),
  http.get(USER_MODE_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(PEPPY);
  }),
  http.get(USER_URL, ({ request, params }) => {
    requests.push(new URL(request.url));
    const found = params.user === "2" || String(params.user).toLowerCase() === "@peppy";
    return found ? HttpResponse.json(PEPPY) : new HttpResponse(null, { status: 404 });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
  tokens = 0;
});

const client = () =>
  createOsuClient({
    credentials: { clientId: "1", clientSecret: "shh" },
    userAgent: "haruhime-osu-tests (+https://haruhime.moe)",
  });

const peppy = { osuId: 2, username: "peppy", avatarUrl: "https://a.ppy.sh/2", countryCode: "AU" };

describe("getUser", () => {
  it("finds a user by id with key=id, and by name with @", async () => {
    const osu = client();
    expect(await osu.getUser(2)).toEqual(peppy);
    expect(await osu.getUser(" PePpY ")).toEqual(peppy);
    expect(requests.map((url) => url.pathname + url.search)).toEqual([
      "/api/v2/users/2?key=id",
      "/api/v2/users/@PePpY",
    ]);
    expect(tokens).toBe(1);
  });

  it("asks for a ruleset's stats in the path", async () => {
    expect(await client().getUser(2, { ruleset: "mania" })).toEqual(peppy);
    expect(requests[0]?.pathname).toBe("/api/v2/users/2/mania");
  });

  it("answers null on 404", async () => {
    expect(await client().getUser("nobody")).toBeNull();
    expect(await client().getUser(99)).toBeNull();
  });

  it("refuses bad input before any call", async () => {
    const osu = client();
    await expect(osu.getUser(0)).rejects.toThrow(RangeError);
    await expect(osu.getUser(1.5)).rejects.toThrow(RangeError);
    await expect(osu.getUser("  ")).rejects.toThrow(RangeError);
    // @ts-expect-error an unknown ruleset
    await expect(osu.getUser(2, { ruleset: "catch" })).rejects.toThrow(RangeError);
    expect(requests).toEqual([]);
  });

  it("throws a budget error when beforeCall refuses, without calling osu!", async () => {
    const error = await client()
      .getUser(2, { beforeCall: async () => false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OsuApiError);
    expect((error as OsuApiError).code).toBe("budget");
    expect(tokens).toBe(0);
  });

  it("retries once after a 401 with a fresh token", async () => {
    let calls = 0;
    server.use(
      http.get(USER_URL, () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 401 }) : HttpResponse.json(PEPPY);
      }),
    );
    expect(await client().getUser(2)).toEqual(peppy);
    expect(tokens).toBe(2);
  });

  it("throws on an error status and on a body without an identity", async () => {
    server.use(http.get(USER_URL, () => new HttpResponse(null, { status: 500 })));
    await expect(client().getUser(2)).rejects.toMatchObject({ code: "http_error", status: 500 });
    server.use(http.get(USER_URL, () => HttpResponse.json({ id: 2 })));
    await expect(client().getUser(2)).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("getUsers", () => {
  it("files found, missing and unchecked ids", async () => {
    const result = await client().getUsers([2, 2, 3, 7, -1]);
    expect(result.found).toEqual(new Map([[2, peppy]]));
    expect(result.missing).toEqual([3, -1]);
    expect(result.unchecked).toEqual([7]);
    expect(requests[0]?.searchParams.getAll("ids[]")).toEqual(["2", "3", "7"]);
  });

  it("sends 50 ids a call and leaves refused batches unchecked", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    let asks = 0;
    const result = await client().getUsers(ids, { beforeCall: async () => ++asks !== 2 });
    expect(requests.map((url) => url.searchParams.getAll("ids[]").length)).toEqual([50, 20]);
    expect(result.unchecked).toEqual([7, ...ids.slice(50, 100)]);
    expect(result.found.has(2)).toBe(true);
  });

  it("throws when osu! answers an error or an unreadable body", async () => {
    server.use(http.get(USERS_URL, () => new HttpResponse(null, { status: 503 })));
    await expect(client().getUsers([2])).rejects.toMatchObject({ code: "http_error" });
    server.use(http.get(USERS_URL, () => HttpResponse.json({ nope: [] })));
    await expect(client().getUsers([2])).rejects.toMatchObject({ code: "bad_response" });
  });
});
