/**
 * @file tests/match.test.ts
 * @desc The match shapes (toOsuMatch, parseMatchId, both score formats) and the /match helpers:
 *       game status (aborted, stuck, in progress), team vs and head-to-head winners by score,
 *       accuracy and combo, ties, passedOnly, warmups and map wins.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { describe, expect, it } from "vitest";
import {
  gameStatus,
  gameWinner,
  isTeamGame,
  listGames,
  mapWins,
  matchGames,
} from "../src/match/index.js";
import {
  type MatchGame,
  type OsuMatch,
  osuMatchScoreSchema,
  parseMatchId,
  toOsuMatch,
} from "../src/shapes/index.js";
import pages from "./fixtures/match-pages.json" with { type: "json" };

/** Both fixture pages as one match, the way getMatch merges them. */
const whole = (): OsuMatch => {
  const newer = toOsuMatch(pages.newer);
  return { ...newer, events: [...toOsuMatch(pages.older).events, ...newer.events] };
};

describe("toOsuMatch", () => {
  it("maps a page to camelCase, events oldest first", () => {
    const match = toOsuMatch({ ...pages.newer, events: [...pages.newer.events].reverse() });
    expect(match.events.map((event) => event.id)).toEqual([5, 6, 7, 8, 9]);
    expect(match.events[4]).toEqual({
      id: 9,
      type: "match-disbanded",
      text: null,
      timestamp: "2026-10-03T18:59:00+00:00",
      userId: null,
      game: null,
    });
    expect(match.events[0]?.game).toEqual({
      id: 1005,
      beatmapId: 75,
      startTime: "2026-10-03T18:16:00+00:00",
      endTime: "2026-10-03T18:20:00+00:00",
      ruleset: "osu",
      scoringType: "scorev2",
      teamType: "team-vs",
      mods: ["NF"],
      beatmap: { id: 75, beatmapsetId: 750, version: "Insane" },
      scores: [
        {
          userId: 2,
          slot: 0,
          team: "red",
          score: 900000,
          accuracy: 0.98,
          maxCombo: 800,
          misses: 1,
          mods: ["NF", "HD"],
          passed: true,
        },
        expect.objectContaining({ userId: 124493, team: "blue", misses: 2, mods: ["NF"] }),
      ],
    });
    expect(match.users[1]).toEqual({
      osuId: 124493,
      username: "Cookiezi",
      avatarUrl: "https://a.ppy.sh/124493",
      countryCode: "KR",
    });
  });

  it("reads the newer score format too: mod objects, total_score and statistics.miss", () => {
    const score = osuMatchScoreSchema.parse({
      user_id: 2,
      total_score: 123456,
      accuracy: 0.9,
      max_combo: 10,
      mods: [{ acronym: "hd", settings: {} }],
      passed: false,
      statistics: { great: 5, miss: 3 },
      match: { slot: 2, team: "none", pass: false },
    });
    const match = toOsuMatch({
      ...pages.newer,
      events: [
        {
          ...pages.newer.events[0],
          game: { ...pages.newer.events[0]?.game, scores: [score], beatmap: null },
        },
      ],
    });
    expect(match.events[0]?.game).toMatchObject({
      beatmap: null,
      scores: [{ score: 123456, misses: 3, mods: ["HD"], passed: false, team: "none" }],
    });
  });

  it("gives a score with neither score field 0, and no misses as 0", () => {
    const [event] = toOsuMatch({
      ...pages.newer,
      events: [
        {
          ...pages.newer.events[0],
          game: {
            ...pages.newer.events[0]?.game,
            scores: [
              {
                user_id: 2,
                accuracy: 1,
                max_combo: 1,
                passed: true,
                match: { slot: 0, team: "red" },
              },
            ],
          },
        },
      ],
    }).events;
    expect(event?.game?.scores[0]).toMatchObject({ score: 0, misses: 0, mods: [] });
  });

  it("throws on a page that isn't a match", () => {
    expect(() => toOsuMatch({ match: { id: 1 } })).toThrow();
  });
});

describe("parseMatchId", () => {
  it("reads ids and mp links", () => {
    expect(parseMatchId(111)).toBe(111);
    expect(parseMatchId(" 111 ")).toBe(111);
    expect(parseMatchId("https://osu.ppy.sh/community/matches/111")).toBe(111);
    expect(parseMatchId("http://osu.ppy.sh/community/matches/111/")).toBe(111);
    expect(parseMatchId("https://osu.ppy.sh/mp/111?x=1#y")).toBe(111);
    expect(parseMatchId("osu.ppy.sh/mp/111")).toBe(111);
    expect(parseMatchId("https://www.osu.ppy.sh/mp/111")).toBe(111);
  });

  it("refuses anything else", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "",
      "1.0",
      "-5",
      "0",
      "99999999999999999999",
      "https://osu.ppy.sh/users/2",
      "https://example.com/mp/111",
      "https://osu.ppy.sh/mp/111/extra",
      "https://",
    ]) {
      expect(parseMatchId(bad), String(bad)).toBeNull();
    }
  });
});

const teamGame = (scores: MatchGame["scores"], teamType = "team-vs"): MatchGame => ({
  id: 1,
  beatmapId: 1,
  startTime: "",
  endTime: "2026-10-03T18:00:00+00:00",
  ruleset: "osu",
  scoringType: "scorev2",
  teamType,
  mods: [],
  beatmap: null,
  scores,
});

const s = (
  userId: number,
  team: "red" | "blue" | "none",
  score: number,
  more: Partial<MatchGame["scores"][number]> = {},
): MatchGame["scores"][number] => ({
  userId,
  slot: 0,
  team,
  score,
  accuracy: 1,
  maxCombo: 0,
  misses: 0,
  mods: [],
  passed: true,
  ...more,
});

describe("game status and lists", () => {
  it("tells completed, aborted, stuck and in-progress games apart", () => {
    const games = matchGames(whole());
    expect(games.map((game) => game.id)).toEqual([1003, 1004, 1005, 1006, 1007, 1008]);
    expect(games.map((game, index) => gameStatus(game, index < games.length - 1))).toEqual([
      "completed",
      "aborted",
      "completed",
      "completed",
      "aborted",
      "completed",
    ]);
    expect(gameStatus({ ...teamGame([]), endTime: null })).toBe("in_progress");
  });

  it("lists completed games and skips warmups", () => {
    expect(listGames(whole()).map((game) => game.id)).toEqual([1003, 1005, 1006, 1008]);
    expect(listGames(whole(), { warmups: 1 }).map((game) => game.id)).toEqual([1005, 1006, 1008]);
    expect(listGames(whole(), { warmups: 10 })).toEqual([]);
    expect(() => listGames(whole(), { warmups: -1 })).toThrow(RangeError);
    expect(() => listGames(whole(), { warmups: 0.5 })).toThrow(RangeError);
  });

  it("knows team games", () => {
    expect(isTeamGame(teamGame([]))).toBe(true);
    expect(isTeamGame(teamGame([], "tag-team-vs"))).toBe(true);
    expect(isTeamGame(teamGame([], "head-to-head"))).toBe(false);
    expect(isTeamGame(teamGame([], "tag-coop"))).toBe(false);
  });
});

describe("gameWinner", () => {
  it("sums each team's score, leaving out team none", () => {
    const result = gameWinner(
      teamGame([s(1, "red", 300), s(2, "red", 300), s(3, "blue", 500), s(4, "none", 9999)]),
    );
    expect(result.winner).toBe("red");
    expect(result.totals).toEqual(
      new Map([
        ["red", 600],
        ["blue", 500],
      ]),
    );
  });

  it("ranks players by id in head-to-head", () => {
    const game = teamGame(
      [s(1, "none", 100), s(2, "none", 300), s(3, "none", 200)],
      "head-to-head",
    );
    expect(gameWinner(game).winner).toBe(2);
    expect(gameWinner(game).totals.get(3)).toBe(200);
  });

  it("averages accuracy and sums combo per side", () => {
    const game = teamGame([
      s(1, "red", 0, { accuracy: 1, maxCombo: 100 }),
      s(2, "red", 0, { accuracy: 0.9, maxCombo: 100 }),
      s(3, "blue", 0, { accuracy: 0.96, maxCombo: 150 }),
    ]);
    expect(gameWinner(game, { by: "accuracy" })).toEqual({
      winner: "blue",
      totals: new Map([
        ["red", 0.95],
        ["blue", 0.96],
      ]),
    });
    expect(gameWinner(game, { by: "combo" }).winner).toBe("red");
  });

  it("judges by the room's own win condition unless told otherwise", () => {
    const scores = [s(1, "red", 900, { accuracy: 0.9 }), s(2, "blue", 100, { accuracy: 1 })];
    expect(gameWinner({ ...teamGame(scores), scoringType: "accuracy" }).winner).toBe("blue");
    expect(gameWinner({ ...teamGame(scores), scoringType: "combo" }).totals.get("red")).toBe(0);
    expect(
      gameWinner({ ...teamGame(scores), scoringType: "accuracy" }, { by: "score" }).winner,
    ).toBe("red");
    expect(gameWinner({ ...teamGame(scores), scoringType: "score" }).winner).toBe("red");
  });

  it("leaves out team none and failed scores together", () => {
    const game = teamGame([s(1, "none", 999), s(2, "red", 5, { passed: false }), s(3, "blue", 1)]);
    expect(gameWinner(game, { passedOnly: true }).totals).toEqual(new Map([["blue", 1]]));
  });

  it("counts failed scores unless passedOnly", () => {
    const game = teamGame([s(1, "red", 500, { passed: false }), s(2, "blue", 400)]);
    expect(gameWinner(game).winner).toBe("red");
    expect(gameWinner(game, { passedOnly: true })).toEqual({
      winner: "blue",
      totals: new Map([["blue", 400]]),
    });
  });

  it("gives no winner on a tie or with no scores, even with a lower side after the tie", () => {
    expect(gameWinner(teamGame([s(1, "red", 5), s(2, "blue", 5)])).winner).toBeNull();
    expect(
      gameWinner(teamGame([s(1, "none", 5), s(2, "none", 5), s(3, "none", 1)], "head-to-head"))
        .winner,
    ).toBeNull();
    expect(
      gameWinner(teamGame([s(1, "none", 1), s(2, "none", 5), s(3, "none", 5)], "head-to-head"))
        .winner,
    ).toBeNull();
    expect(
      gameWinner(teamGame([s(1, "none", 5), s(2, "none", 5), s(3, "none", 5)], "head-to-head"))
        .winner,
    ).toBeNull();
    expect(gameWinner(teamGame([]))).toEqual({ winner: null, totals: new Map() });
  });
});

describe("mapWins", () => {
  it("counts map wins over completed games after warmups", () => {
    expect(mapWins(whole())).toEqual(
      new Map([
        ["blue", 2],
        ["red", 2],
      ]),
    );
    expect(mapWins(whole(), { warmups: 1 })).toEqual(
      new Map([
        ["red", 2],
        ["blue", 1],
      ]),
    );
    expect(mapWins(whole(), { warmups: 1, by: "accuracy" })).toEqual(
      new Map([
        ["red", 2],
        ["blue", 1],
      ]),
    );
    // Red's failed accuracy on 1006 stops counting, so blue takes it.
    expect(mapWins(whole(), { warmups: 1, by: "accuracy", passedOnly: true })).toEqual(
      new Map([
        ["red", 1],
        ["blue", 2],
      ]),
    );
  });

  it("skips tied games", () => {
    const match: OsuMatch = {
      ...whole(),
      events: [
        {
          id: 1,
          type: "other",
          text: null,
          timestamp: "",
          userId: null,
          game: teamGame([s(1, "red", 5), s(2, "blue", 5)]),
        },
      ],
    };
    expect(mapWins(match)).toEqual(new Map());
  });
});
