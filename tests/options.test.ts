/**
 * @file tests/options.test.ts
 * @desc Options packs' client didn't have: a required User-Agent, credentials as an object or read
 *       on every token request (non-empty strings only), a custom base URL (https, or http on
 *       localhost), a timeout in setTimeout's range, and a custom fallback cap.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createOsuClient } from "../src/index.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

const UA = "haruhime-osu-tests (+https://haruhime.moe)";
const token = () =>
  HttpResponse.json({ token_type: "Bearer", expires_in: 86400, access_token: "t" });
const server = setupServer(
  http.post("https://osu.ppy.sh/oauth/token", token),
  http.get("https://osu.ppy.sh/api/v2/beatmaps", () =>
    HttpResponse.json({ beatmaps: fixture.beatmaps }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("createOsuClient options", () => {
  it.each(["", "   "])("refuses a blank userAgent %j", (userAgent) => {
    expect(() =>
      createOsuClient({ userAgent, credentials: { clientId: "1", clientSecret: "s" } }),
    ).toThrow("userAgent");
  });

  it("takes credentials as an object", async () => {
    const client = createOsuClient({
      userAgent: UA,
      credentials: { clientId: "1", clientSecret: "s" },
    });
    expect((await client.getBeatmaps([75])).found.size).toBe(1);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, 3e9])(
    "refuses timeoutMs %s",
    (timeoutMs) => {
      expect(() =>
        createOsuClient({
          userAgent: UA,
          timeoutMs,
          credentials: { clientId: "1", clientSecret: "s" },
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([1, 2_147_483_647])("takes timeoutMs %s", (timeoutMs) => {
    expect(() =>
      createOsuClient({
        userAgent: UA,
        timeoutMs,
        credentials: { clientId: "1", clientSecret: "s" },
      }),
    ).not.toThrow();
  });

  it.each(["http://osu.example", "ftp://osu.example", "not a url", "http://localhost.osu.example"])(
    "refuses baseUrl %j, which would get the client secret",
    (baseUrl) => {
      expect(() =>
        createOsuClient({
          userAgent: UA,
          baseUrl,
          credentials: { clientId: "1", clientSecret: "s" },
        }),
      ).toThrow(RangeError);
    },
  );

  it.each(["https://osu.example", "http://localhost:3000", "http://127.0.0.1:9"])(
    "takes baseUrl %j",
    (baseUrl) => {
      expect(() =>
        createOsuClient({
          userAgent: UA,
          baseUrl,
          credentials: { clientId: "1", clientSecret: "s" },
        }),
      ).not.toThrow();
    },
  );

  it.each([
    { clientId: "", clientSecret: "s" },
    { clientId: "1", clientSecret: "" },
    { clientId: "1", clientSecret: undefined },
    { clientId: 1, clientSecret: "s" },
  ])("refuses credentials %j without echoing them", (bad) => {
    const error = (() => {
      try {
        createOsuClient({ userAgent: UA, credentials: bad as never });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).not.toContain('"s"');
  });

  it("refuses a credentials function's empty secret with a TypeError, not a 401", async () => {
    const secret = "   ";
    const client = createOsuClient({
      userAgent: UA,
      credentials: () => ({ clientId: "1", clientSecret: secret }),
    });
    const error = await client.getBeatmaps([75]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("clientSecret");
  });

  it("lets a throwing credentials function's error through as is", async () => {
    const thrown = new Error("no env");
    const client = createOsuClient({
      userAgent: UA,
      credentials: () => {
        throw thrown;
      },
    });
    await expect(client.getBeatmaps([75])).rejects.toBe(thrown);
  });

  it("reads credentials on each token request, not at import", async () => {
    let reads = 0;
    const client = createOsuClient({
      userAgent: UA,
      credentials: () => {
        reads += 1;
        return { clientId: "1", clientSecret: "s" };
      },
    });
    expect(reads).toBe(0);
    await client.getBeatmaps([75]);
    await client.getBeatmaps([75]);
    expect(reads).toBe(1);
  });

  it("talks to another base URL", async () => {
    const seen: string[] = [];
    server.use(
      http.post("https://osu.example/oauth/token", ({ request }) => {
        seen.push(request.url);
        return token();
      }),
      http.get("https://osu.example/api/v2/beatmaps", ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ beatmaps: [] });
      }),
    );
    await createOsuClient({
      userAgent: UA,
      baseUrl: "https://osu.example",
      credentials: { clientId: "1", clientSecret: "s" },
    }).getBeatmaps([75]);
    expect(seen).toEqual(["https://osu.example/oauth/token", "/api/v2/beatmaps"]);
  });

  it("honors a custom fallback cap", async () => {
    const recorded = fixture.beatmaps[0] as (typeof fixture.beatmaps)[number];
    const { availability: _a, ...compactSet } = recorded.beatmapset;
    const rows = [1, 2, 3].map((n) => ({
      ...recorded,
      id: n,
      beatmapset_id: 100 + n,
      beatmapset: { ...compactSet, id: 100 + n },
    }));
    const lookups: string[] = [];
    server.use(
      http.get("https://osu.ppy.sh/api/v2/beatmaps", () => HttpResponse.json({ beatmaps: rows })),
      http.get("https://osu.ppy.sh/api/v2/beatmapsets/:id", ({ params }) => {
        lookups.push(String(params.id));
        return HttpResponse.json({ ...recorded.beatmapset, id: Number(params.id) });
      }),
    );
    const { sets, unchecked } = await createOsuClient({
      userAgent: UA,
      credentials: { clientId: "1", clientSecret: "s" },
    }).getBeatmapsets([1, 2, 3], { fallbackLimit: 1 });
    expect(lookups).toEqual(["101"]);
    expect([...sets.keys()]).toEqual([1]);
    expect(unchecked).toEqual([2, 3]);
  });
});
