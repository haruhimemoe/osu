/**
 * @file src/shapes/beatmap.ts
 * @desc One osu! difficulty: the osu! API v2 row (as osu! and mirrors that copy its shape send it)
 *       and BeatmapMeta, the source-agnostic metadata apps work with. Unknown keys are stripped.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";

/** osu!'s four rulesets, as the osu! API names them. */
export const RULESETS = ["osu", "taiko", "fruits", "mania"] as const;
export type Ruleset = (typeof RULESETS)[number];
export const rulesetSchema = z.enum(RULESETS);

export const beatmapMetaSchema = z.object({
  beatmapId: z.number().int().positive(),
  beatmapsetId: z.number().int().positive(),
  mode: rulesetSchema,
  title: z.string(),
  artist: z.string(),
  version: z.string(),
  creator: z.string(),
  creatorId: z.number().int().positive().nullable(),
  cs: z.number().nonnegative(),
  ar: z.number().nonnegative(),
  od: z.number().nonnegative(),
  hp: z.number().nonnegative(),
  bpm: z.number().nonnegative(),
  lengthSeconds: z.number().int().nonnegative(),
  starRating: z.number().nonnegative(),
  checksum: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
});

/** A difficulty's metadata, whatever source it came from. `od` and `hp` are osu!'s accuracy and drain. */
export type BeatmapMeta = z.infer<typeof beatmapMetaSchema>;

/** A GET /api/v2/beatmaps row (a BeatmapExtended), reduced to what BeatmapMeta needs. */
export const osuBeatmapRowSchema = z.object({
  id: z.number().int().positive(),
  beatmapset_id: z.number().int().positive(),
  mode: rulesetSchema,
  version: z.string(),
  difficulty_rating: z.number().nonnegative(),
  cs: z.number().nonnegative(),
  ar: z.number().nonnegative(),
  accuracy: z.number().nonnegative(),
  drain: z.number().nonnegative(),
  bpm: z.number().nonnegative(),
  total_length: z.number().nonnegative(),
  checksum: z.string().nullish(),
  beatmapset: z.object({
    artist: z.string(),
    title: z.string(),
    creator: z.string(),
    user_id: z.number().int().positive().nullish(),
  }),
});

export type OsuBeatmapRow = z.infer<typeof osuBeatmapRowSchema>;

const MD5 = /^[0-9a-f]{32}$/;

/**
 * @function toBeatmapMeta
 * @param row {OsuBeatmapRow} a validated row
 * @returns {BeatmapMeta} source-agnostic metadata (length rounded; a checksum that isn't an md5
 *          becomes null)
 */
export const toBeatmapMeta = (row: OsuBeatmapRow): BeatmapMeta => ({
  beatmapId: row.id,
  beatmapsetId: row.beatmapset_id,
  mode: row.mode,
  title: row.beatmapset.title,
  artist: row.beatmapset.artist,
  version: row.version,
  creator: row.beatmapset.creator,
  creatorId: row.beatmapset.user_id ?? null,
  cs: row.cs,
  ar: row.ar,
  od: row.accuracy,
  hp: row.drain,
  bpm: row.bpm,
  lengthSeconds: Math.round(row.total_length),
  starRating: row.difficulty_rating,
  checksum: row.checksum && MD5.test(row.checksum) ? row.checksum : null,
});
