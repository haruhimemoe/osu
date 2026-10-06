/**
 * @file src/match/index.ts
 * @desc @haruhimemoe/osu/match: pure helpers over an OsuMatch from getMatch. Games in order, each
 *       game's status (in progress, aborted, completed), each game's winner (team vs or
 *       head-to-head, by score, accuracy or combo) and map wins per side, with warmups skipped.
 *       No tournament rules beyond that. Imports nothing at runtime, so it runs in browsers.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import type { MatchGame, MatchScore, OsuMatch } from "../shapes/match.js";

/** A side of a game: a team colour in team games, a user id in head-to-head. */
export type MatchSide = "red" | "blue" | number;

/** Where a game stands. See gameStatus. */
export type GameStatus = "in_progress" | "aborted" | "completed";

/** What a game is won on. */
export type WinCondition = "score" | "accuracy" | "combo";

/** Options for gameWinner and mapWins. */
export type GameWinnerOptions = {
  /**
   * "score": each side's summed score. "accuracy": each side's mean accuracy. "combo": each
   * side's summed max combo. Default: the room's win condition (`scoringType` "accuracy" or
   * "combo"), else "score" (score v1 or v2, whichever the room used).
   */
  by?: WinCondition | undefined;
  /** Count only passed scores (default false: failed scores count, as in score v2). */
  passedOnly?: boolean | undefined;
};

/** Options for listGames. */
export type ListGamesOptions = {
  /** How many completed games at the start are warmups and left out (default 0). */
  warmups?: number | undefined;
};

/** Options for mapWins: which games (listGames) and how each is won (gameWinner). */
export type MapWinsOptions = ListGamesOptions & GameWinnerOptions;

/** A game's totals per side, and the side with the highest (null on a tie or no scores). */
export type GameResult = { winner: MatchSide | null; totals: Map<MatchSide, number> };

const TEAM_TYPES: readonly string[] = ["team-vs", "tag-team-vs"];

/**
 * @function isTeamGame
 * @param game {MatchGame} a game
 * @returns {boolean} true when the game was played red against blue (team vs or tag team vs)
 */
export const isTeamGame = (game: MatchGame): boolean => TEAM_TYPES.includes(game.teamType);

/**
 * @function matchGames
 * @param match {OsuMatch} a match from getMatch
 * @returns {MatchGame[]} every game, in event order, whatever its status
 */
export const matchGames = (match: OsuMatch): MatchGame[] => {
  const games: MatchGame[] = [];
  for (const event of match.events) if (event.game) games.push(event.game);
  return games;
};

/**
 * @function gameStatus
 * @param game {MatchGame} a game
 * @param later {boolean} whether another game started after it in the same match (default false)
 * @returns {GameStatus} "in_progress" when it has no end time and nothing started after it;
 *          "aborted" when it ended with no scores, or has no end time but a later game started
 *          (osu! never closed it); "completed" otherwise. osu! has no abort flag, so an abort
 *          after some scores were sent reads as completed
 */
export const gameStatus = (game: MatchGame, later = false): GameStatus => {
  if (game.endTime === null) return later ? "aborted" : "in_progress";
  return game.scores.length === 0 ? "aborted" : "completed";
};

/**
 * @function listGames
 * @param match {OsuMatch} a match from getMatch
 * @param options {ListGamesOptions} warmups, the completed games at the start to leave out
 * @returns {MatchGame[]} the completed games, in event order, warmups left out
 * @throws {RangeError} when warmups isn't a non-negative integer
 */
export const listGames = (match: OsuMatch, { warmups = 0 }: ListGamesOptions = {}): MatchGame[] => {
  if (!Number.isSafeInteger(warmups) || warmups < 0) {
    throw new RangeError("warmups must be a non-negative integer.");
  }
  const games = matchGames(match);
  const completed = games.filter(
    (game, index) => gameStatus(game, index < games.length - 1) === "completed",
  );
  return completed.slice(warmups);
};

/** The win condition the room itself used. */
const roomCondition = (game: MatchGame): WinCondition =>
  game.scoringType === "accuracy" || game.scoringType === "combo" ? game.scoringType : "score";

const scoreValue = (score: MatchScore, by: WinCondition): number =>
  by === "accuracy" ? score.accuracy : by === "combo" ? score.maxCombo : score.score;

/**
 * @function gameWinner
 * @param game {MatchGame} a game
 * @param options {GameWinnerOptions} what it's won on, and whether failed scores count
 * @returns {GameResult} totals per side (red and blue in a team game, else each user id) and the
 *          winner. In a team game, scores with team "none" are left out. Accuracy is averaged per
 *          side, score and combo summed
 */
export const gameWinner = (
  game: MatchGame,
  { by = roomCondition(game), passedOnly = false }: GameWinnerOptions = {},
): GameResult => {
  const team = isTeamGame(game);
  const sums = new Map<MatchSide, { total: number; count: number }>();
  for (const score of game.scores) {
    if (passedOnly && !score.passed) continue;
    const side: MatchSide | null = team
      ? score.team === "none"
        ? null
        : score.team
      : score.userId;
    if (side === null) continue;
    const sum = sums.get(side) ?? { total: 0, count: 0 };
    sum.total += scoreValue(score, by);
    sum.count += 1;
    sums.set(side, sum);
  }
  const totals = new Map<MatchSide, number>();
  for (const [side, { total, count }] of sums) {
    totals.set(side, by === "accuracy" ? total / count : total);
  }
  let winner: MatchSide | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const [side, total] of totals) {
    if (total > best) {
      best = total;
      winner = side;
    } else if (total === best) {
      winner = null;
    }
  }
  return { winner, totals };
};

/**
 * @function mapWins
 * @param match {OsuMatch} a match from getMatch
 * @param options {MapWinsOptions} warmups, what a game is won on, and whether failed scores count
 * @returns {Map<MatchSide, number>} maps won per side over the completed games after the warmups.
 *          Tied games count for nobody. Sides that won nothing are absent
 * @throws {RangeError} when warmups isn't a non-negative integer
 */
export const mapWins = (match: OsuMatch, options: MapWinsOptions = {}): Map<MatchSide, number> => {
  const wins = new Map<MatchSide, number>();
  for (const game of listGames(match, options)) {
    const { winner } = gameWinner(game, options);
    if (winner !== null) wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return wins;
};
