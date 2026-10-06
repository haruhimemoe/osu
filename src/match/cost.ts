/**
 * @file src/match/cost.ts
 * @desc Match cost formulas over an OsuMatch, each as its source publishes it: Bathbot
 *       (MaxOhn/Bathbot match_costs.rs), osu!plus's default and its Flashlight option
 *       (limjeck/osuplus osuplus.user.js), and Elitebotix's /osu-matchscore in its default mixed
 *       mode (Eliteronix/Elitebotix osu-matchscore.js). Pure; imports nothing at runtime.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import type { MatchGame, OsuMatch } from "../shapes/match.js";
import { gameWinner, isTeamGame, type ListGamesOptions, listGames } from "./index.js";

/** The match cost formulas matchCosts knows, by name. */
export const MATCH_COST_FORMULAS = ["bathbot", "osuplus", "flashlight", "elitebotix"] as const;
/** One of MATCH_COST_FORMULAS. */
export type MatchCostFormula = (typeof MATCH_COST_FORMULAS)[number];

/** Options for matchCosts: the formula, and which games count (see listGames). */
export type MatchCostOptions = ListGamesOptions & {
  /** Default "bathbot". */
  formula?: MatchCostFormula | undefined;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

/** Adds one game's score ratio to a player's running list. */
const push = (lists: Map<number, number[]>, userId: number, ratio: number): void => {
  const list = lists.get(userId) ?? [];
  list.push(ratio);
  lists.set(userId, list);
};

/** Bathbot: (mean(score / lobby mean) + 0.5) × 1.5^(((p − 1) / (G − 1))^0.6) × mod bonus + tiebreaker. */
const bathbot = (match: OsuMatch, games: readonly MatchGame[]): Map<number, number> => {
  const played = games.map((game) => ({
    game,
    scores: game.scores.filter((score) => score.score > 0),
  }));
  const ratios = new Map<number, number[]>();
  const combos = new Map<number, Set<string>>();
  for (const { scores } of played) {
    if (scores.length === 0) continue;
    const average = mean(scores.map((score) => score.score));
    for (const score of scores) {
      push(ratios, score.userId, score.score / average);
      const combo = score.mods
        .filter((mod) => mod !== "NF")
        .sort()
        .join("");
      const set = combos.get(score.userId) ?? new Set<string>();
      set.add(combo);
      combos.set(score.userId, set);
    }
  }
  // The last game is a tiebreaker when the match is over, ran past 4 games, and was won by one map.
  const tiebreaker = new Map<number, number>();
  const last = played.at(-1);
  if (match.endTime !== null && played.length > 4 && last && isTeamGame(last.game)) {
    let red = 0;
    let blue = 0;
    for (const { game } of played) {
      const { winner } = gameWinner(game, { by: "score" });
      if (winner === "red") red += 1;
      else if (winner === "blue") blue += 1;
    }
    if (Math.abs(red - blue) === 1 && last.scores.length > 0) {
      const average = mean(last.scores.map((score) => score.score));
      for (const score of last.scores) {
        tiebreaker.set(score.userId, Math.min(0.5, 0.25 * (score.score / average)));
      }
    }
  }
  const costs = new Map<number, number>();
  const count = played.length;
  for (const [userId, list] of ratios) {
    const performance = mean(list) + 0.5;
    const exponent = count <= 1 ? 0 : (list.length - 1) / (count - 1);
    const participation = 1.5 ** (exponent ** 0.6);
    const used = combos.get(userId)?.size ?? 0;
    const mods = 1 + (used > 2 ? 0.02 * (used - 2) : 0);
    costs.set(userId, performance * participation * mods + (tiebreaker.get(userId) ?? 0));
  }
  return costs;
};

/** osu!plus default: 2 × Σ(score / lobby mean) / (p + 2). */
const osuplus = (games: readonly MatchGame[]): Map<number, number> => {
  const ratios = new Map<number, number[]>();
  for (const game of games) {
    const total = game.scores.reduce((sum, score) => sum + score.score, 0);
    if (total === 0) continue;
    for (const score of game.scores) {
      push(ratios, score.userId, (score.score * game.scores.length) / total);
    }
  }
  const costs = new Map<number, number>();
  for (const [userId, list] of ratios) {
    costs.set(userId, (2 * list.reduce((sum, ratio) => sum + ratio, 0)) / (list.length + 2));
  }
  return costs;
};

/** Flashlight (as osu!plus ships it): mean(score / lobby median) × ∛(p / median plays). */
const flashlight = (games: readonly MatchGame[]): Map<number, number> => {
  const ratios = new Map<number, number[]>();
  for (const game of games) {
    if (game.scores.length === 0) continue;
    const middle = median(game.scores.map((score) => score.score));
    if (middle === 0) continue;
    for (const score of game.scores) push(ratios, score.userId, score.score / middle);
  }
  const costs = new Map<number, number>();
  if (ratios.size === 0) return costs;
  const medianPlays = median([...ratios.values()].map((list) => list.length));
  for (const [userId, list] of ratios) {
    costs.set(userId, mean(list) * Math.cbrt(list.length / medianPlays));
  }
  return costs;
};

/**
 * Elitebotix /osu-matchscore, mixed mode: Σ(score / middle score) / p × (0.8 + 0.2p). Scores
 * under 10,000 are dropped, games left with one score skipped, and in an even lobby the
 * player's own score is left out so the middle score is one score.
 */
const elitebotix = (games: readonly MatchGame[]): Map<number, number> => {
  const ratios = new Map<number, number[]>();
  for (const game of games) {
    const scores = game.scores.filter((score) => score.score >= 10_000);
    if (scores.length < 2) continue;
    for (const score of scores) {
      const others = scores.length % 2 === 0 ? scores.filter((other) => other !== score) : scores;
      const sorted = others.map((other) => other.score).sort((a, b) => a - b);
      const middle = sorted[Math.floor(sorted.length / 2)] as number;
      push(ratios, score.userId, score.score / middle);
    }
  }
  const costs = new Map<number, number>();
  for (const [userId, list] of ratios) {
    const played = list.length;
    costs.set(
      userId,
      (list.reduce((sum, ratio) => sum + ratio, 0) / played) * (0.8 + 0.2 * played),
    );
  }
  return costs;
};

/**
 * @function matchCosts
 * @param match {OsuMatch} a match from getMatch
 * @param options {MatchCostOptions} the formula (default "bathbot") and warmups
 * @returns {Map<number, number>} each player's match cost by user id, over the completed games
 *          after the warmups (see listGames). Each formula then drops scores as its source does:
 *          Bathbot drops zero scores, Elitebotix scores under 10,000, osu!plus and Flashlight
 *          nothing. A player with no counted score is absent
 * @throws {RangeError} when warmups isn't a non-negative integer, or the formula is unknown
 */
export const matchCosts = (
  match: OsuMatch,
  { formula = "bathbot", warmups = 0 }: MatchCostOptions = {},
): Map<number, number> => {
  const games = listGames(match, { warmups });
  switch (formula) {
    case "bathbot":
      return bathbot(match, games);
    case "osuplus":
      return osuplus(games);
    case "flashlight":
      return flashlight(games);
    case "elitebotix":
      return elitebotix(games);
    default:
      throw new RangeError(`formula must be one of ${MATCH_COST_FORMULAS.join(", ")}.`);
  }
};
