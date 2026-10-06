/**
 * @file tests/match-cost.test.ts
 * @desc matchCosts, each formula against hand-worked values from its published source: Bathbot
 *       (mean ratio + 0.5, participation, mod bonus, tiebreaker), osu!plus, Flashlight and
 *       Elitebotix (mixed mode, own score out of an even lobby, scores under 10,000 dropped).
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { describe, expect, it } from "vitest";
import { MATCH_COST_FORMULAS, type MatchCostFormula, matchCosts } from "../src/match/index.js";
import type { MatchGame, MatchScore, OsuMatch } from "../src/shapes/index.js";

const score = (userId: number, points: number, more: Partial<MatchScore> = {}): MatchScore => ({
  userId,
  slot: 0,
  team: "none",
  score: points,
  accuracy: 1,
  maxCombo: 0,
  misses: 0,
  mods: [],
  passed: true,
  ...more,
});

const game = (id: number, scores: MatchScore[], teamType = "head-to-head"): MatchGame => ({
  id,
  beatmapId: id,
  startTime: "",
  endTime: "2026-10-03T18:00:00+00:00",
  ruleset: "osu",
  scoringType: "scorev2",
  teamType,
  mods: [],
  beatmap: null,
  scores,
});

const matchOf = (games: MatchGame[], endTime: string | null = null): OsuMatch => ({
  id: 1,
  name: "m",
  startTime: "",
  endTime,
  users: [],
  firstEventId: 1,
  latestEventId: games.length,
  events: games.map((one, index) => ({
    id: index + 1,
    type: "other",
    text: null,
    timestamp: "",
    userId: null,
    game: one,
  })),
});

// Player 1 plays 4 of 5 games with ratios 1.2, 1, 0.8, 1 to the lobby mean; player 2 plays all 5.
const k = 1000;
const five = (): MatchGame[] => [
  game(1, [score(1, 600 * k), score(2, 400 * k)]),
  game(2, [score(1, 500 * k), score(2, 500 * k)]),
  game(3, [score(1, 400 * k), score(2, 600 * k)]),
  game(4, [score(1, 500 * k), score(2, 500 * k)]),
  game(5, [score(2, 500 * k)]),
];

const costs = (formula: MatchCostFormula, games = five(), endTime: string | null = null) =>
  matchCosts(matchOf(games, endTime), { formula });

describe("matchCosts", () => {
  it("names its formulas and defaults to bathbot", () => {
    expect(MATCH_COST_FORMULAS).toEqual(["bathbot", "osuplus", "flashlight", "elitebotix"]);
    expect(matchCosts(matchOf(five()))).toEqual(costs("bathbot"));
    expect(() => matchCosts(matchOf(five()), { formula: "x" as never })).toThrow(RangeError);
  });

  it("bathbot: (mean ratio + 0.5) × 1.5^(((p − 1)/(G − 1))^0.6)", () => {
    const result = costs("bathbot");
    expect(result.get(1)).toBeCloseTo(1.5 * 1.5 ** (0.75 ** 0.6), 10);
    expect(result.get(1)).toBeCloseTo(2.11, 2);
    expect(result.get(2)).toBeCloseTo(2.25, 10);
  });

  it("bathbot: drops zero scores, gives one game no participation bonus", () => {
    const result = costs("bathbot", [game(1, [score(1, 300), score(2, 100), score(3, 0)])]);
    expect(result.get(1)).toBeCloseTo(1.5 + 0.5, 10);
    expect(result.has(3)).toBe(false);
  });

  it("bathbot: 0.02 per mod combination past two, NF ignored", () => {
    const combos = [["NF"], ["HD"], ["HR", "NF"], ["DT"]];
    const result = costs(
      "bathbot",
      combos.map((mods, index) => game(index + 1, [score(1, 100, { mods }), score(2, 100)])),
    );
    // Combos NM, HD, HR, DT: four, so 1.04. Ratios all 1, full participation.
    expect(result.get(1)).toBeCloseTo(1.5 * 1.5 * 1.04, 10);
    expect(result.get(2)).toBeCloseTo(2.25, 10);
  });

  it("bathbot: a tiebreaker bonus when a finished match ran past 4 games and was won by one", () => {
    const red = (points: number) => score(1, points, { team: "red" });
    const blue = (points: number) => score(2, points, { team: "blue" });
    const games = [
      game(1, [red(600), blue(400)], "team-vs"),
      game(2, [red(400), blue(600)], "team-vs"),
      game(3, [red(600), blue(400)], "team-vs"),
      game(4, [red(400), blue(600)], "team-vs"),
      game(5, [red(600), blue(400)], "team-vs"),
    ];
    // Red's ratios average 1.04, blue's 0.96; the last game's ratios are 1.2 and 0.8.
    const finished = costs("bathbot", games, "2026-10-03T19:00:00+00:00");
    expect(finished.get(1)).toBeCloseTo(1.54 * 1.5 + 0.3, 10);
    expect(finished.get(2)).toBeCloseTo(1.46 * 1.5 + 0.2, 10);
    // Still running: no tiebreaker yet.
    expect(costs("bathbot", games).get(1)).toBeCloseTo(1.54 * 1.5, 10);
  });

  it("osuplus: 2 × Σ(score / lobby mean) / (p + 2)", () => {
    const result = costs("osuplus");
    expect(result.get(1)).toBeCloseTo((2 * 4) / 6, 10);
    expect(result.get(2)).toBeCloseTo((2 * 5) / 7, 10);
  });

  it("flashlight: mean(score / lobby median) × ∛(p / median plays)", () => {
    const result = costs("flashlight");
    expect(result.get(1)).toBeCloseTo(Math.cbrt(4 / 4.5), 10);
    expect(result.get(2)).toBeCloseTo(Math.cbrt(5 / 4.5), 10);
    expect(costs("flashlight", [game(1, [score(1, 0), score(2, 0)])])).toEqual(new Map());
  });

  it("elitebotix: Σ(score / middle) / p × (0.8 + 0.2p), own score out of an even lobby", () => {
    const result = costs("elitebotix");
    // Game 1: 600k against 400k is 1.5; game 3 is 400/600. Game 5 has one score and is skipped.
    const sum = 1.5 + 1 + 400 / 600 + 1;
    expect(result.get(1)).toBeCloseTo((sum / 4) * 1.6, 10);
    expect(result.get(2)).toBeCloseTo((sum / 4) * 1.6, 10);
  });

  it("elitebotix: odd lobbies use the middle score, and scores under 10,000 are dropped", () => {
    const result = costs("elitebotix", [
      game(1, [score(1, 300 * k), score(2, 200 * k), score(3, 100 * k), score(4, 9_999)]),
    ]);
    expect(result.get(1)).toBeCloseTo(1.5, 10);
    expect(result.get(3)).toBeCloseTo(0.5, 10);
    expect(result.has(4)).toBe(false);
  });

  it("skips warmups and aborted games for every formula", () => {
    const games = [game(9, [score(1, 900 * k), score(2, 100 * k)]), game(8, []), ...five()];
    for (const formula of MATCH_COST_FORMULAS) {
      expect(matchCosts(matchOf(games), { formula, warmups: 1 })).toEqual(costs(formula));
    }
  });

  it("returns nothing for a match without games", () => {
    for (const formula of MATCH_COST_FORMULAS) expect(costs(formula, [])).toEqual(new Map());
  });
});
