/**
 * @file src/client/scores.ts
 * @desc Score and profile lookups for createOsuClient (0.6): a user's profile with one ruleset's
 *       statistics, a user's best, recent or first-place scores, a user's scores on one map, a
 *       map's global leaderboard, and one difficulty with its max combo and ranked status. Score
 *       calls send `x-api-version: 20220705`, so osu! answers in the lazer score format. A row
 *       that fails the schema is left out of a list, never guessed at.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { z } from "zod";
import { osuBeatmapRowSchema, RULESETS, type Ruleset, toBeatmapMeta } from "../shapes/beatmap.js";
import { type OsuScore, osuScoreSchema, toOsuScore } from "../shapes/score.js";
import { type OsuUserProfile, toOsuUserProfile } from "../shapes/user.js";
import { OsuApiError } from "./errors.js";
import { release, type Transport } from "./http.js";
import { isId } from "./options.js";
import type { AuthorizedInit } from "./token.js";
import type {
  BeatmapDetail,
  BeatmapOptions,
  BeatmapScoresOptions,
  UserOptions,
  UserScoresOptions,
  UserScoreType,
} from "./types.js";

/** The API version that makes osu! answer scores in the lazer format. */
export const OSU_SCORES_API_VERSION = "20220705";
/** The most scores osu! sends for one user list or leaderboard call. */
export const OSU_SCORES_LIMIT = 100;

const USER_SCORE_TYPES: readonly UserScoreType[] = ["best", "recent", "firsts"];
const SCORES_INIT: AuthorizedInit = { headers: { "x-api-version": OSU_SCORES_API_VERSION } };
const scoreListSchema = z.array(z.unknown());
const scoresResponseSchema = z.object({ scores: z.array(z.unknown()) });
const beatmapDetailSchema = osuBeatmapRowSchema.extend({
  max_combo: z.number().int().nonnegative().nullish(),
  status: z.string().nullish(),
});
const alwaysCall = async (): Promise<boolean> => true;

/** What the score lookups need from the client. */
type ScoreDeps = {
  baseUrl: string;
  authorized: (url: string | URL, init?: AuthorizedInit) => Promise<Response>;
  transport: Transport;
};

const checkRuleset = (ruleset: string | undefined): Ruleset | undefined => {
  if (ruleset !== undefined && !(RULESETS as readonly string[]).includes(ruleset)) {
    throw new RangeError(`ruleset must be one of ${RULESETS.join(", ")}.`);
  }
  return ruleset as Ruleset | undefined;
};

const checkId = (id: number, what: string): void => {
  if (!isId(id)) throw new RangeError(`${what} must be a positive integer.`);
};

const checkLimit = (limit: number | undefined, max: number): void => {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > max)) {
    throw new RangeError(`limit must be an integer from 1 to ${max}.`);
  }
};

const toScores = (rows: unknown[]): OsuScore[] => {
  const scores: OsuScore[] = [];
  for (const row of rows) {
    const parsed = osuScoreSchema.safeParse(row);
    if (parsed.success) scores.push(toOsuScore(parsed.data));
  }
  return scores;
};

/**
 * @function createScoreLookups
 * @param deps {ScoreDeps} the base URL, the token-carrying request, and the transport
 * @returns {{ getUserProfile, getUserScores, getBeatmapUserScores, getBeatmapScores, getBeatmap }}
 *          the lookups createOsuClient adds to the client
 */
export const createScoreLookups = ({ baseUrl, authorized, transport }: ScoreDeps) => {
  /** One GET; null on a 404, the parsed body otherwise. */
  const getOrNull = async (
    url: URL,
    beforeCall: () => Promise<boolean>,
    init?: AuthorizedInit,
  ): Promise<{ body: unknown; status: number } | null> => {
    if (!(await beforeCall())) {
      throw new OsuApiError("budget", "beforeCall refused the osu! call.");
    }
    const response = await authorized(url, init);
    if (response.status === 404) {
      release(response);
      return null;
    }
    if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
    return { body: await transport.readJson(response), status: response.status };
  };

  return {
    /**
     * @function getUserProfile
     * @param user {number | string} an osu! id, or a username (matched without case)
     * @param options {UserOptions} beforeCall, asked once (your budget), and the ruleset whose
     *        statistics to read (default: the user's own main ruleset)
     * @returns {Promise<OsuUserProfile | null>} the profile, or null when osu! has nobody by
     *          that id or name (404)
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token,
     *         an error status, a body without an id and username, a timeout, or a network failure
     * @throws {RangeError} when the id, name or ruleset isn't valid (before any call)
     */
    async getUserProfile(
      user: number | string,
      { beforeCall = alwaysCall, ruleset }: UserOptions = {},
    ): Promise<OsuUserProfile | null> {
      const mode = checkRuleset(ruleset);
      let path: string;
      if (typeof user === "number") {
        checkId(user, "A user id");
        path = `/users/${user}${mode ? `/${mode}` : ""}?key=id`;
      } else {
        if (user.trim() === "") throw new RangeError("A username must not be blank.");
        path = `/users/@${encodeURIComponent(user.trim())}${mode ? `/${mode}` : ""}`;
      }
      const answer = await getOrNull(new URL(`${baseUrl}/api/v2${path}`), beforeCall);
      if (!answer) return null;
      try {
        return toOsuUserProfile(answer.body);
      } catch (cause) {
        throw new OsuApiError("bad_response", "osu! sent a response we couldn't read.", {
          status: answer.status,
          cause,
        });
      }
    },

    /**
     * @function getUserScores
     * @param userId {number} osu! user id
     * @param type {UserScoreType} "best" (top plays, by pp), "recent" (last 24 hours) or
     *        "firsts" (global #1s)
     * @param options {UserScoresOptions} beforeCall, ruleset (default: the user's main one),
     *        limit (1 to 100, osu!'s default when unset), offset, and includeFails (recent only)
     * @returns {Promise<OsuScore[]>} the scores in osu!'s order; an unknown user is an empty list
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on an error status,
     *         a body that isn't a list, a timeout, or a network failure
     * @throws {RangeError} when the id, type, ruleset, limit or offset isn't valid
     */
    async getUserScores(
      userId: number,
      type: UserScoreType,
      {
        beforeCall = alwaysCall,
        ruleset,
        limit,
        offset,
        includeFails = false,
      }: UserScoresOptions = {},
    ): Promise<OsuScore[]> {
      checkId(userId, "A user id");
      if (!USER_SCORE_TYPES.includes(type)) {
        throw new RangeError(`type must be one of ${USER_SCORE_TYPES.join(", ")}.`);
      }
      const mode = checkRuleset(ruleset);
      checkLimit(limit, OSU_SCORES_LIMIT);
      if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
        throw new RangeError("offset must be a non-negative integer.");
      }
      const url = new URL(`${baseUrl}/api/v2/users/${userId}/scores/${type}`);
      if (mode) url.searchParams.set("mode", mode);
      if (limit !== undefined) url.searchParams.set("limit", String(limit));
      if (offset !== undefined) url.searchParams.set("offset", String(offset));
      if (type === "recent" && includeFails) url.searchParams.set("include_fails", "1");
      const answer = await getOrNull(url, beforeCall, SCORES_INIT);
      if (!answer) return [];
      return toScores(transport.readAs(scoreListSchema, answer.body, answer.status));
    },

    /**
     * @function getBeatmapUserScores
     * @param beatmapId {number} difficulty id
     * @param userId {number} osu! user id
     * @param options {BeatmapScoresOptions} beforeCall and ruleset (for converts; default: the
     *        map's own)
     * @returns {Promise<OsuScore[]>} every score the user has on the map (best first as osu!
     *          sends them); an unknown map or user is an empty list
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on an error status,
     *         an unreadable body, a timeout, or a network failure
     * @throws {RangeError} when an id or the ruleset isn't valid
     */
    async getBeatmapUserScores(
      beatmapId: number,
      userId: number,
      { beforeCall = alwaysCall, ruleset }: BeatmapScoresOptions = {},
    ): Promise<OsuScore[]> {
      checkId(beatmapId, "beatmapId");
      checkId(userId, "A user id");
      const mode = checkRuleset(ruleset);
      const url = new URL(`${baseUrl}/api/v2/beatmaps/${beatmapId}/scores/users/${userId}/all`);
      if (mode) url.searchParams.set("mode", mode);
      const answer = await getOrNull(url, beforeCall, SCORES_INIT);
      if (!answer) return [];
      return toScores(transport.readAs(scoresResponseSchema, answer.body, answer.status).scores);
    },

    /**
     * @function getBeatmapScores
     * @param beatmapId {number} difficulty id
     * @param options {BeatmapScoresOptions} beforeCall, ruleset, and limit (1 to 100)
     * @returns {Promise<OsuScore[]>} the global leaderboard, best first; an unknown map is an
     *          empty list
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on an error status,
     *         an unreadable body, a timeout, or a network failure
     * @throws {RangeError} when the id, ruleset or limit isn't valid
     */
    async getBeatmapScores(
      beatmapId: number,
      { beforeCall = alwaysCall, ruleset, limit }: BeatmapScoresOptions = {},
    ): Promise<OsuScore[]> {
      checkId(beatmapId, "beatmapId");
      const mode = checkRuleset(ruleset);
      checkLimit(limit, OSU_SCORES_LIMIT);
      const url = new URL(`${baseUrl}/api/v2/beatmaps/${beatmapId}/scores`);
      if (mode) url.searchParams.set("mode", mode);
      if (limit !== undefined) url.searchParams.set("limit", String(limit));
      const answer = await getOrNull(url, beforeCall, SCORES_INIT);
      if (!answer) return [];
      return toScores(transport.readAs(scoresResponseSchema, answer.body, answer.status).scores);
    },

    /**
     * @function getBeatmap
     * @param beatmapId {number} difficulty id
     * @param options {BeatmapOptions} beforeCall, asked once (your budget)
     * @returns {Promise<BeatmapDetail | null>} the difficulty's metadata with its max combo and
     *          ranked status, or null when osu! has no such map (404)
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on an error status,
     *         a body that isn't a beatmap, a timeout, or a network failure
     * @throws {RangeError} when beatmapId isn't a positive integer
     */
    async getBeatmap(
      beatmapId: number,
      { beforeCall = alwaysCall }: BeatmapOptions = {},
    ): Promise<BeatmapDetail | null> {
      checkId(beatmapId, "beatmapId");
      const answer = await getOrNull(
        new URL(`${baseUrl}/api/v2/beatmaps/${beatmapId}`),
        beforeCall,
      );
      if (!answer) return null;
      const row = transport.readAs(beatmapDetailSchema, answer.body, answer.status);
      return {
        ...toBeatmapMeta(row),
        maxCombo: row.max_combo ?? null,
        status: row.status ?? null,
      };
    },
  };
};
