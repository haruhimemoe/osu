/**
 * @file tests/hardening.test.ts
 * @desc Failure handling beyond packs' client: every failure talking to osu! is an OsuApiError with
 *       a code (unreadable bodies, network errors, timeouts, HTTP errors with Retry-After, a
 *       refused budget), getBeatmaps and getStarRating honor beforeCall, rows that fail the
 *       schema are unchecked, bad inputs are refused or skipped, one token request serves
 *       concurrent calls, and only one 401 is retried.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { describe, expect, it } from "vitest";
import { createOsuClient, OsuApiError } from "../src/index.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

type Call = { url: string; init: RequestInit | undefined };
const TOKEN = () => Response.json({ access_token: "t", expires_in: 86400 });

// A client whose fetch answers from `route`, recording every call.
const stub = (
  route: (url: string, init?: RequestInit) => Response | Promise<Response>,
  options: {
    timeoutMs?: number;
    baseUrl?: string;
    credentials?: () => { clientId: string; clientSecret: string };
    token?: () => Response;
  } = {},
) => {
  const calls: Call[] = [];
  const { token = TOKEN, ...rest } = options;
  const client = createOsuClient({
    userAgent: "tests",
    credentials: { clientId: "1", clientSecret: "s" },
    ...rest,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return String(input).endsWith("/oauth/token") ? token() : route(String(input), init);
    },
  });
  return { client, calls };
};
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("every failure is an OsuApiError", () => {
  it("wraps a 200 that isn't JSON", async () => {
    const { client } = stub(() => new Response("<html>cloudflare</html>"));
    const error = await failure(client.getBeatmaps([75]));
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ status: 200, code: "bad_response", retryAfterMs: null });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("wraps a /beatmaps body of the wrong shape", async () => {
    const { client } = stub(() => Response.json({ nope: true }));
    const error = await failure(client.getBeatmapsets([75]));
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ status: 200, code: "bad_response" });
  });

  it("wraps a token body it can't read", async () => {
    const client = createOsuClient({
      userAgent: "tests",
      credentials: { clientId: "1", clientSecret: "s" },
      fetch: async () => Response.json({ token_type: "Bearer" }),
    });
    expect(await failure(client.getBeatmaps([75]))).toBeInstanceOf(OsuApiError);
  });

  it("wraps a star rating body that isn't JSON", async () => {
    const { client } = stub(() => new Response("oops"));
    expect(await failure(client.getStarRating(75, ["HD"]))).toBeInstanceOf(OsuApiError);
  });

  it("wraps a network failure, with no status", async () => {
    const { client } = stub(() => {
      throw new TypeError("fetch failed");
    });
    const error = await failure(client.getBeatmaps([75]));
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ status: null, code: "network" });
  });

  it("gives up on a request that takes longer than timeoutMs", async () => {
    const { client } = stub(
      (_, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      { timeoutMs: 20 },
    );
    const error = await failure(client.getBeatmaps([75]));
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ status: null, code: "timeout" });
    expect((error as Error).message).toContain("in time");
  });

  it("reports a timeout while the body is read as a timeout", async () => {
    const { client } = stub(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("The operation timed out.", "TimeoutError"));
            },
          }),
        ),
    );
    const error = await failure(client.getBeatmaps([75]));
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ status: 200, code: "timeout" });
  });

  it("gives an HTTP error its code, and no Retry-After when osu! sent none", async () => {
    const { client } = stub(() => new Response(null, { status: 500 }));
    expect(await failure(client.getBeatmaps([75]))).toMatchObject({
      status: 500,
      code: "http_error",
      retryAfterMs: null,
    });
  });

  it.each([
    [429, "5", 5000],
    [503, "120", 60_000],
    [429, "soon", null],
    [500, "5", null],
  ])("reads a %i's Retry-After %j as %j ms", async (status, header, retryAfterMs) => {
    const { client } = stub(
      () => new Response(null, { status, headers: { "Retry-After": header } }),
    );
    expect(await failure(client.getBeatmaps([75]))).toMatchObject({
      status,
      code: "http_error",
      retryAfterMs,
    });
  });

  it("reads Retry-After as an HTTP date", async () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const { client } = stub(
      () => new Response(null, { status: 429, headers: { "Retry-After": at } }),
    );
    const error = (await failure(client.getBeatmaps([75]))) as OsuApiError;
    expect(error.retryAfterMs).toBeGreaterThan(20_000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  it("reads the token request's Retry-After too", async () => {
    const { client } = stub(() => Response.json({ beatmaps: [] }), {
      token: () => new Response(null, { status: 429, headers: { "Retry-After": "7" } }),
    });
    expect(await failure(client.getBeatmaps([75]))).toMatchObject({
      status: 429,
      code: "http_error",
      retryAfterMs: 7000,
    });
  });
});

describe("callbacks", () => {
  it("lets a throwing beforeCall's error through as is", async () => {
    const thrown = new Error("budget store down");
    const { client } = stub(() => Response.json({ beatmaps: [] }));
    const beforeCall = async () => {
      throw thrown;
    };
    await expect(client.getBeatmaps([75], { beforeCall })).rejects.toBe(thrown);
    await expect(client.getBeatmapsets([75], { beforeCall })).rejects.toBe(thrown);
    await expect(client.getStarRating(75, ["HD"], { beforeCall })).rejects.toBe(thrown);
  });

  it("never files a credentials problem during a fallback under unchecked", async () => {
    const recorded = fixture.beatmaps[0] as (typeof fixture.beatmaps)[number];
    const { availability: _a, ...compactSet } = recorded.beatmapset;
    let reads = 0;
    const { client } = stub(
      (url) =>
        url.includes("/beatmapsets/")
          ? new Response(null, { status: 401 })
          : Response.json({
              beatmaps: [
                { ...recorded, id: 80, beatmapset_id: 5, beatmapset: { ...compactSet, id: 5 } },
              ],
            }),
      { credentials: () => ({ clientId: "1", clientSecret: ++reads === 1 ? "s" : "" }) },
    );
    await expect(client.getBeatmapsets([80])).rejects.toBeInstanceOf(TypeError);
  });
});

describe("getStarRating budget", () => {
  it("rejects with code budget, and sends nothing, when beforeCall refuses", async () => {
    const { client, calls } = stub(() => Response.json({ attributes: { star_rating: 5 } }));
    const error = await failure(
      client.getStarRating(75, ["HD"], { beforeCall: async () => false }),
    );
    expect(error).toBeInstanceOf(OsuApiError);
    expect(error).toMatchObject({ code: "budget", status: null });
    expect(calls).toEqual([]);
  });

  it("asks beforeCall once, then calls osu!", async () => {
    let asks = 0;
    const { client } = stub(() => Response.json({ attributes: { star_rating: 5 } }));
    const stars = await client.getStarRating(75, ["HD"], { beforeCall: async () => ++asks > 0 });
    expect(stars).toBe(5);
    expect(asks).toBe(1);
  });
});

describe("rows that fail the schema", () => {
  const recorded = fixture.beatmaps[0] as (typeof fixture.beatmaps)[number];
  // A title must be a string, so this row is osu!'s but unreadable to both row schemas.
  const broken = { ...recorded, id: 76, beatmapset: { ...recorded.beatmapset, title: 5 } };

  it("puts a broken row's id in getBeatmaps' unchecked, not missing", async () => {
    const { client } = stub(() => Response.json({ beatmaps: [recorded, broken] }));
    const { found, missing, unchecked } = await client.getBeatmaps([75, 76, 77]);
    expect([...found.keys()]).toEqual([75]);
    expect(missing).toEqual([77]);
    expect(unchecked).toEqual([76]);
  });

  it("puts every unanswered id of a batch in unchecked when a row has no readable id", async () => {
    const { client } = stub(() => Response.json({ beatmaps: [recorded, { nope: true }] }));
    const { found, missing, unchecked } = await client.getBeatmaps([75, 76, 77, -1]);
    expect([...found.keys()]).toEqual([75]);
    expect(missing).toEqual([-1]);
    expect(unchecked).toEqual([76, 77]);
  });

  it("ignores rows, good or broken, for ids it didn't ask for", async () => {
    const { client } = stub(() =>
      Response.json({ beatmaps: [recorded, { ...recorded, id: 9 }, { ...broken, id: 10 }] }),
    );
    const { found, missing, unchecked } = await client.getBeatmaps([75, 77]);
    expect([...found.keys()]).toEqual([75]);
    expect(missing).toEqual([77]);
    expect(unchecked).toEqual([]);
  });

  it("puts a broken row's id in getBeatmapsets' unchecked", async () => {
    const { client } = stub(() => Response.json({ beatmaps: [recorded, broken] }));
    const { sets, unchecked } = await client.getBeatmapsets([75, 76, 77]);
    expect([...sets.keys()]).toEqual([75]);
    expect(unchecked).toEqual([76]);
  });

  it("puts a getBeatmapsets batch's unanswered ids in unchecked when a row has no id", async () => {
    const { client } = stub(() => Response.json({ beatmaps: [recorded, "nope"] }));
    const { sets, unchecked } = await client.getBeatmapsets([75, 76, 77]);
    expect([...sets.keys()]).toEqual([75]);
    expect(unchecked).toEqual([76, 77]);
  });
});

describe("getBeatmaps budget", () => {
  it("asks beforeCall per batch and reports refused ids as unchecked", async () => {
    const { client, calls } = stub(() => Response.json({ beatmaps: fixture.beatmaps }));
    let asks = 0;
    const ids = Array.from({ length: 60 }, (_, i) => i + 40);
    const result = await client.getBeatmaps(ids, { beforeCall: async () => ++asks === 1 });
    expect(asks).toBe(2);
    expect(calls.filter((call) => call.url.includes("/api/v2/beatmaps"))).toHaveLength(1);
    expect([...result.found.keys()]).toEqual([75]);
    expect(result.unchecked).toEqual(ids.slice(50));
    expect(result.missing).toEqual(ids.slice(0, 50).filter((id) => id !== 75));
  });
});

describe("bad input", () => {
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    "refuses fallbackLimit %s",
    async (fallbackLimit) => {
      const { client } = stub(() => Response.json({ beatmaps: [] }));
      await expect(client.getBeatmapsets([75], { fallbackLimit })).rejects.toThrow(RangeError);
    },
  );

  it("never sends ids that aren't positive safe integers, and calls them missing", async () => {
    const { client, calls } = stub(() => Response.json({ beatmaps: fixture.beatmaps }));
    const { found, missing } = await client.getBeatmaps([75, 1.5, -3, Number.NaN, 1e21]);
    const sent = new URL(calls.at(-1)?.url ?? "").searchParams.getAll("ids[]");
    expect(sent).toEqual(["75"]);
    expect([...found.keys()]).toEqual([75]);
    expect(missing).toEqual([1.5, -3, Number.NaN, 1e21]);
  });

  it("refuses a star rating id that isn't a positive safe integer", async () => {
    const { client, calls } = stub(() => Response.json({}));
    await expect(client.getStarRating("1/../../me" as unknown as number, ["HD"])).rejects.toThrow(
      RangeError,
    );
    expect(calls).toEqual([]);
  });

  it("refuses a userAgent with control characters", () => {
    expect(() =>
      createOsuClient({
        userAgent: "app\r\nX: y",
        credentials: { clientId: "1", clientSecret: "s" },
      }),
    ).toThrow("userAgent");
  });

  it("drops trailing slashes from baseUrl", async () => {
    const { client, calls } = stub(() => Response.json({ beatmaps: [] }), {
      baseUrl: "https://osu.example//",
    });
    await client.getBeatmaps([75]);
    expect(calls.map((call) => call.url.split("?")[0])).toEqual([
      "https://osu.example/oauth/token",
      "https://osu.example/api/v2/beatmaps",
    ]);
  });
});

describe("tokens", () => {
  it("shares one token request between concurrent calls", async () => {
    const { client, calls } = stub(() => Response.json({ beatmaps: [] }));
    await Promise.all([
      client.getBeatmaps([1]),
      client.getBeatmaps([2]),
      client.getStarRating(3, ["HD"]).catch(() => null),
    ]);
    expect(calls.filter((call) => call.url.endsWith("/oauth/token"))).toHaveLength(1);
  });

  it("retries a 401 once, not twice", async () => {
    const { client, calls } = stub(() => new Response(null, { status: 401 }));
    const error = await failure(client.getBeatmaps([75]));
    expect(error).toMatchObject({ status: 401 });
    expect(calls.filter((call) => call.url.includes("/api/v2/beatmaps"))).toHaveLength(2);
  });
});

describe("getBeatmapsets edges", () => {
  const recorded = fixture.beatmaps[0] as (typeof fixture.beatmaps)[number];
  const { availability: _a, ...compactSet } = recorded.beatmapset;
  const compactRow = {
    ...recorded,
    id: 80,
    beatmapset_id: 5,
    beatmapset: { ...compactSet, id: 5 },
  };

  it("calls a set unchecked when its fallback answer is compact too", async () => {
    const { client } = stub((url) =>
      url.includes("/beatmapsets/")
        ? Response.json({ ...compactSet, id: 5 })
        : Response.json({ beatmaps: [compactRow] }),
    );
    expect(await client.getBeatmapsets([80])).toEqual({ sets: new Map(), unchecked: [80] });
  });

  it("makes no fallback calls with fallbackLimit 0", async () => {
    const { client, calls } = stub(() => Response.json({ beatmaps: [compactRow] }));
    const { unchecked } = await client.getBeatmapsets([80], { fallbackLimit: 0 });
    expect(unchecked).toEqual([80]);
    expect(calls.some((call) => call.url.includes("/beatmapsets/"))).toBe(false);
  });

  it("throws when /beatmaps itself fails", async () => {
    const { client } = stub(() => new Response(null, { status: 503 }));
    expect(await failure(client.getBeatmapsets([80]))).toMatchObject({ status: 503 });
  });
});
