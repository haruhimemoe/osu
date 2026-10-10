/**
 * @file tests/scores.test.ts
 * @desc Score and profile lookups (0.6): getUserProfile by id or name with a ruleset, statistics
 *       mapped with defaults, null on 404; getUserScores with type, mode, limit, offset and
 *       include_fails, the lazer API version header, bad rows left out; getBeatmapUserScores and
 *       getBeatmapScores unwrap `{ scores }`; getBeatmap adds max combo and status; the budget,
 *       error statuses and argument checks.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOsuClient,
  OSU_SCORES_API_VERSION,
  OsuApiError,
  osuScoreSchema,
  toOsuScore,
} from "../src/index.js";

const BASE = "https://osu.ppy.sh/api/v2";

const SCORE = {
  id: 4_000_000_001,
  user_id: 2,
  beatmap_id: 75,
  ruleset_id: 0,
  accuracy: 0.9876,
  max_combo: 314,
  mods: [{ acronym: "HD" }, { acronym: "DT", settings: { speed_change: 1.3 } }],
  statistics: { great: 300, ok: 4, miss: 1 },
  maximum_statistics: { great: 305 },
  rank: "A",
  pp: 123.45,
  total_score: 912_345,
  legacy_total_score: 0,
  passed: true,
  is_perfect_combo: false,
  ended_at: "2026-10-06T12:00:00Z",
  weight: { percentage: 100, pp: 123.45 },
  beatmap: {
    id: 75,
    beatmapset_id: 1,
    version: "Normal",
    difficulty_rating: 2.55,
    mode: "osu",
    checksum: "a5b99395a42bd55bc5eb1d2411cbdf8b",
    max_combo: 314,
  },
  beatmapset: {
    id: 1,
    title: "DISCOPRINCE",
    artist: "Kenji Ninuma",
    title_unicode: "ディスコプリンス",
    creator: "peppy",
  },
  user: { id: 2, username: "peppy", avatar_url: null, country_code: "AU" },
};

const PROFILE = {
  id: 2,
  username: "peppy",
  avatar_url: "https://a.ppy.sh/2",
  country_code: "AU",
  playmode: "osu",
  join_date: "2007-08-28T03:09:12+00:00",
  is_supporter: true,
  cover: { url: "https://assets.ppy.sh/cover.jpg" },
  statistics: {
    pp: 1234.5,
    global_rank: 100,
    country_rank: null,
    hit_accuracy: 97.5,
    play_count: 50,
    play_time: 3600,
    ranked_score: 10,
    total_hits: 20,
    maximum_combo: 30,
    level: { current: 100, progress: 42 },
    grade_counts: { ss: 1, ssh: 2, s: 3, sh: 4, a: 5 },
  },
};

let requests: Request[] = [];

const server = setupServer(
  http.post("https://osu.ppy.sh/oauth/token", () =>
    HttpResponse.json({ expires_in: 86400, access_token: "token" }),
  ),
  http.get(`${BASE}/users/:user/scores/:type`, ({ request, params }) => {
    requests.push(request);
    if (params.user === "404") return new HttpResponse(null, { status: 404 });
    if (params.user === "500") return new HttpResponse(null, { status: 500 });
    return HttpResponse.json([SCORE, { id: "broken" }]);
  }),
  http.get(`${BASE}/users/:user/:mode`, ({ request, params }) => {
    requests.push(request);
    if (params.user === "404") return new HttpResponse(null, { status: 404 });
    if (params.user === "1") return HttpResponse.json({ id: 1 });
    return HttpResponse.json(PROFILE);
  }),
  http.get(`${BASE}/users/:user`, ({ request, params }) => {
    requests.push(request);
    if (params.user === "3") return HttpResponse.json({ id: 3, username: "new" });
    return HttpResponse.json(PROFILE);
  }),
  http.get(`${BASE}/beatmaps/:id/scores/users/:user/all`, ({ request, params }) => {
    requests.push(request);
    if (params.id === "404") return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ scores: [SCORE] });
  }),
  http.get(`${BASE}/beatmaps/:id/scores`, ({ request, params }) => {
    requests.push(request);
    if (params.id === "404") return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ scores: [SCORE, SCORE] });
  }),
  http.get(`${BASE}/beatmaps/:id`, ({ request, params }) => {
    requests.push(request);
    if (params.id === "404") return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      id: 75,
      beatmapset_id: 1,
      mode: "osu",
      version: "Normal",
      difficulty_rating: 2.55,
      cs: 4,
      ar: 6,
      accuracy: 6,
      drain: 6,
      bpm: 120,
      total_length: 142,
      checksum: "a5b99395a42bd55bc5eb1d2411cbdf8b",
      max_combo: 314,
      status: "ranked",
      beatmapset: { artist: "Kenji Ninuma", title: "DISCOPRINCE", creator: "peppy", user_id: 2 },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
});

const client = () =>
  createOsuClient({
    userAgent: "haruhime-osu-tests (+https://haruhime.moe)",
    credentials: { clientId: "1", clientSecret: "s" },
  });
const lastUrl = (): URL => new URL(requests.at(-1)?.url ?? "");

describe("getUserProfile", () => {
  it("reads a profile by id with a ruleset", async () => {
    const profile = await client().getUserProfile(2, { ruleset: "osu" });
    expect(lastUrl().pathname).toBe("/api/v2/users/2/osu");
    expect(lastUrl().searchParams.get("key")).toBe("id");
    expect(profile).toMatchObject({
      osuId: 2,
      username: "peppy",
      playmode: "osu",
      supporter: true,
      coverUrl: "https://assets.ppy.sh/cover.jpg",
      statistics: {
        pp: 1234.5,
        globalRank: 100,
        countryRank: null,
        accuracy: 97.5,
        level: 100.42,
        grades: { ssh: 2, ss: 1, sh: 4, s: 3, a: 5 },
      },
    });
  });

  it("reads by name without a ruleset", async () => {
    await client().getUserProfile(" peppy ");
    expect(lastUrl().pathname).toBe("/api/v2/users/@peppy");
  });

  it("fills defaults for a profile without statistics", async () => {
    const profile = await client().getUserProfile(3);
    expect(profile?.statistics).toMatchObject({ pp: 0, globalRank: null, level: 0 });
    expect(profile?.supporter).toBe(false);
  });

  it("answers null on 404 and rejects an unreadable profile", async () => {
    expect(await client().getUserProfile(404, { ruleset: "taiko" })).toBeNull();
    await expect(client().getUserProfile(1, { ruleset: "osu" })).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("checks its arguments and the budget", async () => {
    await expect(client().getUserProfile(0)).rejects.toThrow(RangeError);
    await expect(client().getUserProfile("  ")).rejects.toThrow(RangeError);
    // @ts-expect-error an unknown ruleset
    await expect(client().getUserProfile(2, { ruleset: "std" })).rejects.toThrow(RangeError);
    await expect(
      client().getUserProfile(2, { beforeCall: async () => false }),
    ).rejects.toMatchObject({ code: "budget" });
  });
});

describe("getUserScores", () => {
  it("lists scores with every option and the lazer header, leaving out bad rows", async () => {
    const scores = await client().getUserScores(2, "recent", {
      ruleset: "mania",
      limit: 5,
      offset: 10,
      includeFails: true,
    });
    const url = lastUrl();
    expect(url.pathname).toBe("/api/v2/users/2/scores/recent");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mode: "mania",
      limit: "5",
      offset: "10",
      include_fails: "1",
    });
    expect(requests.at(-1)?.headers.get("x-api-version")).toBe(OSU_SCORES_API_VERSION);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      id: 4_000_000_001,
      ruleset: "osu",
      rank: "A",
      pp: 123.45,
      weightedPp: 123.45,
      perfectCombo: false,
      beatmap: { beatmapId: 75, maxCombo: 314, starRating: 2.55 },
      beatmapset: { title: "DISCOPRINCE", titleUnicode: "ディスコプリンス", artistUnicode: null },
      user: { osuId: 2, username: "peppy", avatarUrl: null },
    });
  });

  it("only sends include_fails for recent, and nothing it wasn't given", async () => {
    await client().getUserScores(2, "best", { includeFails: true });
    expect([...lastUrl().searchParams.keys()]).toEqual([]);
  });

  it("answers an empty list on 404 and throws on errors", async () => {
    expect(await client().getUserScores(404, "best")).toEqual([]);
    await expect(client().getUserScores(500, "best")).rejects.toBeInstanceOf(OsuApiError);
  });

  it("checks its arguments", async () => {
    await expect(client().getUserScores(0, "best")).rejects.toThrow(RangeError);
    // @ts-expect-error an unknown type
    await expect(client().getUserScores(2, "pinned")).rejects.toThrow(RangeError);
    await expect(client().getUserScores(2, "best", { limit: 101 })).rejects.toThrow(RangeError);
    await expect(client().getUserScores(2, "best", { offset: -1 })).rejects.toThrow(RangeError);
  });
});

describe("beatmap scores", () => {
  it("lists a user's scores on a map", async () => {
    const scores = await client().getBeatmapUserScores(75, 2, { ruleset: "taiko" });
    expect(lastUrl().pathname).toBe("/api/v2/beatmaps/75/scores/users/2/all");
    expect(lastUrl().searchParams.get("mode")).toBe("taiko");
    expect(scores).toHaveLength(1);
    expect(await client().getBeatmapUserScores(404, 2)).toEqual([]);
    await expect(client().getBeatmapUserScores(75, 0)).rejects.toThrow(RangeError);
  });

  it("reads a leaderboard", async () => {
    const scores = await client().getBeatmapScores(75, { limit: 50, ruleset: "osu" });
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ mode: "osu", limit: "50" });
    expect(scores).toHaveLength(2);
    expect(await client().getBeatmapScores(404)).toEqual([]);
    await expect(client().getBeatmapScores(75, { limit: 0 })).rejects.toThrow(RangeError);
  });
});

describe("getBeatmap", () => {
  it("adds max combo and status to the metadata", async () => {
    const map = await client().getBeatmap(75);
    expect(map).toMatchObject({
      beatmapId: 75,
      title: "DISCOPRINCE",
      maxCombo: 314,
      status: "ranked",
    });
    expect(await client().getBeatmap(404)).toBeNull();
    await expect(client().getBeatmap(-1)).rejects.toThrow(RangeError);
  });
});

describe("toOsuScore", () => {
  it("fills nulls for missing optional fields and drops a bad checksum", () => {
    const score = toOsuScore(
      osuScoreSchema.parse({
        ...SCORE,
        pp: undefined,
        legacy_total_score: undefined,
        maximum_statistics: undefined,
        is_perfect_combo: undefined,
        weight: undefined,
        beatmap: { ...SCORE.beatmap, checksum: "nope", max_combo: undefined },
        beatmapset: undefined,
        user: undefined,
      }),
    );
    expect(score).toMatchObject({
      pp: null,
      legacyTotalScore: null,
      maximumStatistics: null,
      perfectCombo: false,
      weightedPp: null,
      beatmap: { checksum: null, maxCombo: null },
      beatmapset: null,
      user: null,
    });
  });
});
