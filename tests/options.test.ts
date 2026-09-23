/**
 * @file tests/options.test.ts
 * @desc Options packs' client didn't have: a required User-Agent, credentials as an object or read
 *       lazily, a custom base URL, and a custom fallback cap.
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
    expect(await client.getBeatmaps([75])).toHaveLength(1);
  });

  it("reads credentials lazily, on the first request", async () => {
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
