/**
 * @file tests/client.test.ts
 * @desc osu! API client: client-credentials token (cached, refreshed, retried once on 401),
 *       ids[] batching, row mapping, getStarRating (POST beatmaps/{id}/attributes with the mods;
 *       null for a missing map or refused mods, throws on server errors or a body without a
 *       rating, retries once after a 401), and beatmapsets with the capped /beatmapsets/{id}
 *       fallback (a 404 set is gone; a failed or unreadable lookup is unchecked) and the
 *       beforeCall hook that can refuse a call.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsuClient, OsuApiError } from "../src/index.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

const SERVER_USER_AGENT = "haruhime-osu-tests (+https://haruhime.moe)";

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const BEATMAPS_URL = "https://osu.ppy.sh/api/v2/beatmaps";
const BEATMAPSET_URL = "https://osu.ppy.sh/api/v2/beatmapsets/:id";
const ATTRIBUTES_URL = "https://osu.ppy.sh/api/v2/beatmaps/:id/attributes";

let tokenBodies: URLSearchParams[] = [];
let beatmapRequests: URL[] = [];
let tokenCount = 0;

const server = setupServer(
  http.post(TOKEN_URL, async ({ request }) => {
    tokenBodies.push(new URLSearchParams(await request.text()));
    tokenCount += 1;
    return HttpResponse.json({
      token_type: "Bearer",
      expires_in: 86400,
      access_token: `token-${tokenCount}`,
    });
  }),
  http.get(BEATMAPS_URL, ({ request }) => {
    const url = new URL(request.url);
    beatmapRequests.push(url);
    const ids = url.searchParams.getAll("ids[]").map(Number);
    return HttpResponse.json({ beatmaps: fixture.beatmaps.filter((b) => ids.includes(b.id)) });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  tokenBodies = [];
  beatmapRequests = [];
  tokenCount = 0;
});

const credentials = () => ({ clientId: "1", clientSecret: "shh-secret" });

describe("createOsuClient", () => {
  it("maps rows for the ids it asked for", async () => {
    const client = createOsuClient({ userAgent: SERVER_USER_AGENT, credentials });
    const beatmaps = await client.getBeatmaps([75, 999]);
    expect(beatmaps.map((b) => [b.beatmapId, b.title])).toEqual([[75, "DISCOPRINCE"]]);
    expect(beatmapRequests[0]?.searchParams.getAll("ids[]")).toEqual(["75", "999"]);
  });

  it("gets one client-credentials token and reuses it", async () => {
    const client = createOsuClient({ userAgent: SERVER_USER_AGENT, credentials });
    await client.getBeatmaps([75]);
    await client.getBeatmaps([75]);
    expect(tokenBodies).toHaveLength(1);
    expect(Object.fromEntries(tokenBodies[0] ?? [])).toEqual({
      client_id: "1",
      client_secret: "shh-secret",
      grant_type: "client_credentials",
      scope: "public",
    });
  });

  it("refreshes the token a minute before it expires", async () => {
    let now = 0;
    const client = createOsuClient({ userAgent: SERVER_USER_AGENT, credentials, now: () => now });
    await client.getBeatmaps([75]);
    now = 86_400_000 - 30_000;
    await client.getBeatmaps([75]);
    expect(tokenBodies).toHaveLength(2);
  });

  it("retries once with a fresh token after a 401", async () => {
    let rejected = false;
    server.use(
      http.get(BEATMAPS_URL, ({ request }) => {
        if (!rejected) {
          rejected = true;
          return new HttpResponse(null, { status: 401 });
        }
        expect(request.headers.get("authorization")).toBe("Bearer token-2");
        return HttpResponse.json({ beatmaps: fixture.beatmaps });
      }),
    );
    const client = createOsuClient({ userAgent: SERVER_USER_AGENT, credentials });
    expect(await client.getBeatmaps([75])).toHaveLength(1);
  });

  it("asks for at most 50 ids per request", async () => {
    const client = createOsuClient({ userAgent: SERVER_USER_AGENT, credentials });
    await client.getBeatmaps(Array.from({ length: 51 }, (_, i) => i + 1));
    expect(beatmapRequests.map((u) => u.searchParams.getAll("ids[]").length)).toEqual([50, 1]);
  });

  it("throws OsuApiError without the secret when the token request fails", async () => {
    server.use(http.post(TOKEN_URL, () => new HttpResponse(null, { status: 401 })));
    const error = await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials })
      .getBeatmaps([75])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OsuApiError);
    expect((error as OsuApiError).status).toBe(401);
    expect((error as Error).message).not.toContain("shh-secret");
  });

  it("sends our User-Agent on the token request and on every API call", async () => {
    const seen: string[] = [];
    server.use(
      http.post(TOKEN_URL, ({ request }) => {
        seen.push(`token ${request.headers.get("user-agent")}`);
        return HttpResponse.json({ token_type: "Bearer", expires_in: 86400, access_token: "t" });
      }),
      http.get(BEATMAPS_URL, ({ request }) => {
        seen.push(`beatmaps ${request.headers.get("user-agent")}`);
        return HttpResponse.json({ beatmaps: [] });
      }),
    );
    await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getBeatmaps(
      Array.from({ length: 51 }, (_, i) => i + 1),
    );
    expect(seen).toEqual([
      `token ${SERVER_USER_AGENT}`,
      `beatmaps ${SERVER_USER_AGENT}`,
      `beatmaps ${SERVER_USER_AGENT}`,
    ]);
  });

  it("sends our User-Agent on the retry after a 401 too", async () => {
    const agents: (string | null)[] = [];
    let rejected = false;
    server.use(
      http.get(BEATMAPS_URL, ({ request }) => {
        agents.push(request.headers.get("user-agent"));
        if (!rejected) {
          rejected = true;
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ beatmaps: [] });
      }),
    );
    await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getBeatmaps([75]);
    expect(agents).toEqual([SERVER_USER_AGENT, SERVER_USER_AGENT]);
  });
});

describe("getStarRating", () => {
  const seen: {
    id: string;
    body: unknown;
    auth: string | null;
    agent: string | null;
    type: string | null;
  }[] = [];
  beforeEach(() => {
    seen.length = 0;
    server.use(
      http.post(ATTRIBUTES_URL, async ({ params, request }) => {
        seen.push({
          id: String(params.id),
          body: await request.json(),
          auth: request.headers.get("authorization"),
          agent: request.headers.get("user-agent"),
          type: request.headers.get("content-type"),
        });
        if (params.id === "404") return new HttpResponse(null, { status: 404 });
        if (params.id === "422")
          return HttpResponse.json({ error: "invalid mods" }, { status: 422 });
        if (params.id === "500") return new HttpResponse(null, { status: 500 });
        if (params.id === "999") return HttpResponse.json({ nope: true });
        return HttpResponse.json({ attributes: { star_rating: 8.21, max_combo: 2385 } });
      }),
    );
  });

  it("posts the mods and reads attributes.star_rating", async () => {
    const stars = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getStarRating(129891, ["HD", "HR"]);
    expect(stars).toBe(8.21);
    expect(seen).toEqual([
      {
        id: "129891",
        body: { mods: ["HD", "HR"] },
        auth: "Bearer token-1",
        agent: SERVER_USER_AGENT,
        type: "application/json",
      },
    ]);
  });

  it.each([404, 422])("answers null when osu! says %i", async (status) => {
    expect(
      await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getStarRating(status, [
        "HD",
      ]),
    ).toBeNull();
  });

  it("throws on a server error", async () => {
    await expect(
      createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getStarRating(500, ["HD"]),
    ).rejects.toBeInstanceOf(OsuApiError);
  });

  it("throws on a body without a rating", async () => {
    await expect(
      createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getStarRating(999, ["HD"]),
    ).rejects.toBeInstanceOf(OsuApiError);
  });

  it("gets a new token and retries once after a 401", async () => {
    let first = true;
    server.use(
      http.post(ATTRIBUTES_URL, ({ request }) => {
        if (first) {
          first = false;
          return new HttpResponse(null, { status: 401 });
        }
        expect(request.headers.get("authorization")).toBe("Bearer token-2");
        return HttpResponse.json({ attributes: { star_rating: 6.5 } });
      }),
    );
    expect(
      await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getStarRating(1, ["DT"]),
    ).toBe(6.5);
    expect(tokenCount).toBe(2);
  });
});

describe("getBeatmapsets", () => {
  const recorded = fixture.beatmaps[0] as (typeof fixture.beatmaps)[number];
  /** A second difficulty of the recorded set, and a compact row (no availability/track_id/tags). */
  const sibling = { ...recorded, id: 76 };
  const { availability: _a, track_id: _t, tags: _g, ...compactSet } = recorded.beatmapset;
  const compact = { ...recorded, id: 80, beatmapset_id: 5, beatmapset: { ...compactSet, id: 5 } };

  let setRequests: string[] = [];
  beforeEach(() => {
    setRequests = [];
  });

  const serve = (rows: unknown[], setStatus = 200) =>
    server.use(
      http.get(BEATMAPS_URL, ({ request }) => {
        const ids = new URL(request.url).searchParams.getAll("ids[]").map(Number);
        return HttpResponse.json({
          beatmaps: rows.filter((row) => ids.includes((row as { id: number }).id)),
        });
      }),
      http.get(BEATMAPSET_URL, ({ params }) => {
        setRequests.push(String(params.id));
        if (setStatus !== 200) return new HttpResponse(null, { status: setStatus });
        return HttpResponse.json({
          ...recorded.beatmapset,
          id: Number(params.id),
          title: "Full set",
        });
      }),
    );

  it("maps each known id to its set's facts, one set for sibling difficulties", async () => {
    serve([recorded, sibling]);
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([75, 76, 999]);
    expect([...facts.keys()]).toEqual([75, 76]);
    expect(facts.get(75)).toMatchObject({ id: 1, status: "ranked", tags: "katamari" });
    expect(facts.get(76)).toBe(facts.get(75));
    expect(unchecked).toEqual([]);
    expect(setRequests).toEqual([]);
  });

  it("asks /beatmapsets/{id} once for a set sent without the check's fields", async () => {
    serve([compact, { ...compact, id: 81 }]);
    const { sets: facts } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([80, 81]);
    expect(setRequests).toEqual(["5"]);
    expect(facts.get(80)).toMatchObject({
      id: 5,
      title: "Full set",
      availability: { more_information: null },
    });
    expect(facts.get(81)).toBe(facts.get(80));
  });

  it("looks up at most 10 incomplete sets per call and reports the rest as unchecked", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...compact,
      id: 100 + i,
      beatmapset_id: 200 + i,
      beatmapset: { ...compactSet, id: 200 + i },
    }));
    serve(rows);
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets(rows.map((row) => row.id));
    expect(setRequests).toEqual(Array.from({ length: 10 }, (_, i) => String(200 + i)));
    expect([...facts.keys()]).toEqual(Array.from({ length: 10 }, (_, i) => 100 + i));
    expect(unchecked).toEqual([110, 111]);
  });

  it("treats a set osu! no longer has as unknown, not unchecked", async () => {
    serve([compact], 404);
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([80]);
    expect(facts.size).toBe(0);
    expect(unchecked).toEqual([]);
  });

  it.each([429, 500, 503])(
    "reports a set as unchecked when its lookup answers %i, and keeps the facts it has",
    async (status) => {
      const other = { ...compact, id: 90, beatmapset_id: 6, beatmapset: { ...compactSet, id: 6 } };
      serve([recorded, compact, other]);
      server.use(
        http.get(BEATMAPSET_URL, ({ params }) => {
          setRequests.push(String(params.id));
          if (params.id === "5") return new HttpResponse(null, { status });
          return HttpResponse.json({ ...recorded.beatmapset, id: Number(params.id) });
        }),
      );
      const { sets: facts, unchecked } = await createOsuClient({
        userAgent: SERVER_USER_AGENT,
        credentials,
      }).getBeatmapsets([75, 80, 90]);
      expect(setRequests).toEqual(["5", "6"]);
      expect([...facts.keys()]).toEqual([75, 90]);
      expect(unchecked).toEqual([80]);
    },
  );

  it("still counts a failed set lookup against the cap", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...compact,
      id: 100 + i,
      beatmapset_id: 200 + i,
      beatmapset: { ...compactSet, id: 200 + i },
    }));
    serve(rows, 503);
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets(rows.map((row) => row.id));
    expect(setRequests).toHaveLength(10);
    expect(facts.size).toBe(0);
    expect(unchecked).toEqual(rows.map((row) => row.id));
  });

  it("reports a set as unchecked, not missing, when its body can't be read", async () => {
    serve([compact]);
    server.use(
      http.get(BEATMAPSET_URL, ({ params }) => {
        setRequests.push(String(params.id));
        return HttpResponse.json({ id: Number(params.id), nope: true });
      }),
    );
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([80]);
    expect(setRequests).toEqual(["5"]);
    expect(facts.size).toBe(0);
    expect(unchecked).toEqual([80]);
  });

  it("reports a set as unchecked when its body isn't JSON", async () => {
    serve([compact]);
    server.use(
      http.get(BEATMAPSET_URL, () => new HttpResponse("<html>oops</html>", { status: 200 })),
    );
    const { unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([80]);
    expect(unchecked).toEqual([80]);
  });

  it("asks for at most 50 ids per /beatmaps request", async () => {
    const { sets: facts } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets(Array.from({ length: 64 }, (_, i) => i + 40));
    expect(beatmapRequests.map((u) => u.searchParams.getAll("ids[]").length)).toEqual([50, 14]);
    expect([...facts.keys()]).toEqual([75]);
  });

  /** A beforeCall hook that allows the first `allowed` calls and refuses the rest, counting asks. */
  const gate = (allowed: number) => {
    const hook = { asks: 0, beforeCall: async () => ++hook.asks <= allowed };
    return hook;
  };

  it("asks beforeCall once per osu! API call", async () => {
    serve([compact, { ...compact, id: 81 }]);
    const hook = gate(Number.POSITIVE_INFINITY);
    await createOsuClient({ userAgent: SERVER_USER_AGENT, credentials }).getBeatmapsets(
      [80, 81],
      hook,
    );
    expect(hook.asks).toBe(2);
    expect(setRequests).toEqual(["5"]);
  });

  it("skips a /beatmaps call beforeCall refuses and reports its ids as unchecked", async () => {
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets(
      Array.from({ length: 64 }, (_, i) => i + 40),
      gate(1),
    );
    expect(beatmapRequests).toHaveLength(1);
    expect([...facts.keys()]).toEqual([75]);
    expect(unchecked).toEqual(Array.from({ length: 14 }, (_, i) => i + 90));
  });

  it("skips a set lookup beforeCall refuses and reports that set's ids as unchecked", async () => {
    const other = { ...compact, id: 90, beatmapset_id: 6, beatmapset: { ...compactSet, id: 6 } };
    serve([compact, other]);
    const { sets: facts, unchecked } = await createOsuClient({
      userAgent: SERVER_USER_AGENT,
      credentials,
    }).getBeatmapsets([80, 90], gate(2));
    expect(setRequests).toEqual(["5"]);
    expect([...facts.keys()]).toEqual([80]);
    expect(unchecked).toEqual([90]);
  });
});
