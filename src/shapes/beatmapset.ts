/**
 * @file src/shapes/beatmapset.ts
 * @desc One osu! beatmapset's content and licensing fields: status, artist and title (with their
 *       unicode forms), source, tags, the Featured Artist track id, and availability (downloads
 *       disabled, content notice). A BeatmapsetExtended has them all; a compact beatmapset lacks
 *       availability, track_id or tags. Unknown keys are stripped. @haruhimemoe/compliance judges
 *       an extended set.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";

export const osuBeatmapsetSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  artist: z.string(),
  title: z.string(),
  artist_unicode: z.string().nullish(),
  title_unicode: z.string().nullish(),
  source: z.string().nullish(),
  // Absent (not null) on a compact beatmapset.
  tags: z.string().nullish(),
  track_id: z.number().int().nullish(),
  availability: z
    .object({ download_disabled: z.boolean(), more_information: z.string().nullish() })
    .optional(),
});

/** A beatmapset as osu! sent it: extended, or compact (see isExtendedBeatmapset). */
export type OsuBeatmapset = z.infer<typeof osuBeatmapsetSchema>;

/** A beatmapset with every content field present (null where osu! has none). */
export type OsuBeatmapsetExtended = OsuBeatmapset & {
  availability: NonNullable<OsuBeatmapset["availability"]>;
  track_id: number | null;
  tags: string | null;
};

/**
 * @function isExtendedBeatmapset
 * @param set {OsuBeatmapset} a parsed beatmapset
 * @returns {boolean} true when availability, track_id and tags are all present; a compact set
 *          needs GET /api/v2/beatmapsets/{id} for them
 */
export const isExtendedBeatmapset = (set: OsuBeatmapset): set is OsuBeatmapsetExtended =>
  set.availability !== undefined && set.track_id !== undefined && set.tags !== undefined;

/** A GET /api/v2/beatmaps row, reduced to its set. A row with no beatmapset fails to parse. */
export const osuBeatmapsetRowSchema = z.object({
  id: z.number().int().positive(),
  beatmapset_id: z.number().int().positive(),
  beatmapset: osuBeatmapsetSchema,
});
