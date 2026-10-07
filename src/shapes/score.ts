/**
 * @file src/shapes/score.ts
 * @desc One osu! score in the lazer format (API version 20220705 and later): the score rows
 *       /users/{id}/scores/{type} and /beatmaps/{id}/scores send, and OsuScore, the camelCase
 *       score apps work with. Mods are acronyms with optional settings (rate changes, etc.);
 *       statistics stay a name-to-count record, since each ruleset counts different judgements.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { z } from "zod";
import { RULESETS, type Ruleset } from "./beatmap.js";

/** The grades a score can get. X and XH are SS and silver SS; F is a fail. */
export const SCORE_RANKS = ["XH", "X", "SH", "S", "A", "B", "C", "D", "F"] as const;
/** One of SCORE_RANKS. */
export type ScoreRank = (typeof SCORE_RANKS)[number];

/** One mod as lazer sends it: the acronym, and its settings when changed from the defaults. */
export const osuModSchema = z.object({
  acronym: z.string().min(1).max(4),
  settings: z.record(z.string(), z.unknown()).optional(),
});

/** A mod on a score. */
export type OsuMod = z.infer<typeof osuModSchema>;

/** A lazer score row, reduced to what OsuScore needs, in osu!'s snake_case. */
export const osuScoreSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  beatmap_id: z.number().int().positive(),
  ruleset_id: z.number().int().min(0).max(3),
  accuracy: z.number().min(0).max(1),
  max_combo: z.number().int().nonnegative(),
  mods: z.array(osuModSchema),
  statistics: z.record(z.string(), z.number()),
  maximum_statistics: z.record(z.string(), z.number()).nullish(),
  rank: z.enum(SCORE_RANKS),
  pp: z.number().nonnegative().nullish(),
  total_score: z.number().int().nonnegative(),
  legacy_total_score: z.number().int().nonnegative().nullish(),
  passed: z.boolean(),
  is_perfect_combo: z.boolean().nullish(),
  ended_at: z.string(),
  weight: z.object({ percentage: z.number(), pp: z.number() }).nullish(),
  beatmap: z
    .object({
      id: z.number().int().positive(),
      beatmapset_id: z.number().int().positive(),
      version: z.string(),
      difficulty_rating: z.number().nonnegative(),
      mode: z.enum(RULESETS),
      checksum: z.string().nullish(),
      max_combo: z.number().int().nonnegative().nullish(),
    })
    .nullish(),
  beatmapset: z
    .object({
      id: z.number().int().positive(),
      title: z.string(),
      artist: z.string(),
      creator: z.string(),
    })
    .nullish(),
  user: z
    .object({
      id: z.number().int().positive(),
      username: z.string().min(1),
      avatar_url: z.string().nullish(),
      country_code: z.string().nullish(),
    })
    .nullish(),
});

/** A parsed lazer score row. */
export type OsuScoreRow = z.infer<typeof osuScoreSchema>;

/** The difficulty a score was set on, as the score row carries it. */
export type OsuScoreBeatmap = {
  beatmapId: number;
  beatmapsetId: number;
  version: string;
  starRating: number;
  mode: Ruleset;
  checksum: string | null;
  maxCombo: number | null;
};

/** The set a score's difficulty belongs to, as the score row carries it. */
export type OsuScoreBeatmapset = {
  beatmapsetId: number;
  title: string;
  artist: string;
  creator: string;
};

/** Who set a score, as the score row carries it. */
export type OsuScoreUser = {
  osuId: number;
  username: string;
  avatarUrl: string | null;
  countryCode: string | null;
};

/** One score. `accuracy` is 0 to 1. `pp` is null for unranked maps and fails. */
export type OsuScore = {
  id: number;
  userId: number;
  beatmapId: number;
  ruleset: Ruleset;
  mods: OsuMod[];
  accuracy: number;
  maxCombo: number;
  statistics: Record<string, number>;
  maximumStatistics: Record<string, number> | null;
  rank: ScoreRank;
  pp: number | null;
  totalScore: number;
  legacyTotalScore: number | null;
  passed: boolean;
  perfectCombo: boolean;
  endedAt: string;
  /** In a top-plays list: this score's weighted pp. */
  weightedPp: number | null;
  beatmap: OsuScoreBeatmap | null;
  beatmapset: OsuScoreBeatmapset | null;
  user: OsuScoreUser | null;
};

const MD5 = /^[0-9a-f]{32}$/;

/**
 * @function toOsuScore
 * @param row {OsuScoreRow} a validated score row
 * @returns {OsuScore} the score in camelCase (a checksum that isn't an md5 becomes null)
 */
export const toOsuScore = (row: OsuScoreRow): OsuScore => ({
  id: row.id,
  userId: row.user_id,
  beatmapId: row.beatmap_id,
  ruleset: RULESETS[row.ruleset_id] as Ruleset,
  mods: row.mods,
  accuracy: row.accuracy,
  maxCombo: row.max_combo,
  statistics: row.statistics,
  maximumStatistics: row.maximum_statistics ?? null,
  rank: row.rank,
  pp: row.pp ?? null,
  totalScore: row.total_score,
  legacyTotalScore: row.legacy_total_score ?? null,
  passed: row.passed,
  perfectCombo: row.is_perfect_combo ?? false,
  endedAt: row.ended_at,
  weightedPp: row.weight?.pp ?? null,
  beatmap: row.beatmap
    ? {
        beatmapId: row.beatmap.id,
        beatmapsetId: row.beatmap.beatmapset_id,
        version: row.beatmap.version,
        starRating: row.beatmap.difficulty_rating,
        mode: row.beatmap.mode,
        checksum:
          row.beatmap.checksum && MD5.test(row.beatmap.checksum) ? row.beatmap.checksum : null,
        maxCombo: row.beatmap.max_combo ?? null,
      }
    : null,
  beatmapset: row.beatmapset
    ? {
        beatmapsetId: row.beatmapset.id,
        title: row.beatmapset.title,
        artist: row.beatmapset.artist,
        creator: row.beatmapset.creator,
      }
    : null,
  user: row.user
    ? {
        osuId: row.user.id,
        username: row.user.username,
        avatarUrl: row.user.avatar_url ?? null,
        countryCode: row.user.country_code ?? null,
      }
    : null,
});
