/**
 * @file src/shapes/user.ts
 * @desc The osu! user an app signs in: GET /api/v2/me reduced to id, username, avatar and
 *       country. osu! never shares an email; key accounts on the osu! id.
 *       Also (0.6) the profile with one ruleset's statistics, from GET /api/v2/users/{id}/{ruleset}.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Oct 6, 2026
 */

import { z } from "zod";
import { RULESETS, type Ruleset } from "./beatmap.js";

/** GET /api/v2/me, reduced to what OsuUser needs, in osu!'s snake_case. */
export const osuUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  avatar_url: z.string().nullish(),
  country_code: z.string().nullish(),
  country: z.object({ code: z.string().nullish() }).nullish(),
});

/** The signed-in osu! user. Key accounts on `osuId`; osu! never shares an email. */
export type OsuUser = {
  osuId: number;
  username: string;
  avatarUrl: string | null;
  countryCode: string | null;
};

/**
 * @function toOsuUser
 * @param raw {unknown} the /api/v2/me profile
 * @returns {OsuUser} id, username, avatar and country (from `country.code`, else `country_code`)
 * @throws {z.ZodError} when the profile has no id or username (never guess an identity)
 */
export const toOsuUser = (raw: unknown): OsuUser => {
  const profile = osuUserSchema.parse(raw);
  return {
    osuId: profile.id,
    username: profile.username,
    avatarUrl: profile.avatar_url ?? null,
    countryCode: profile.country?.code ?? profile.country_code ?? null,
  };
};

/** GET /api/v2/users/{id}/{ruleset}, reduced to OsuUserProfile's fields, in osu!'s snake_case. */
export const osuUserProfileSchema = osuUserSchema.extend({
  playmode: z.enum(RULESETS).nullish(),
  join_date: z.string().nullish(),
  is_supporter: z.boolean().nullish(),
  cover: z.object({ url: z.string().nullish() }).nullish(),
  statistics: z
    .object({
      pp: z.number().nonnegative().nullish(),
      global_rank: z.number().int().positive().nullish(),
      country_rank: z.number().int().positive().nullish(),
      hit_accuracy: z.number().nonnegative().nullish(),
      play_count: z.number().int().nonnegative().nullish(),
      play_time: z.number().int().nonnegative().nullish(),
      ranked_score: z.number().int().nonnegative().nullish(),
      total_hits: z.number().int().nonnegative().nullish(),
      maximum_combo: z.number().int().nonnegative().nullish(),
      level: z.object({ current: z.number(), progress: z.number() }).nullish(),
      grade_counts: z
        .object({
          ss: z.number().int().nullish(),
          ssh: z.number().int().nullish(),
          s: z.number().int().nullish(),
          sh: z.number().int().nullish(),
          a: z.number().int().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

/** One ruleset's numbers on a profile. A user who never played it has nulls and zeros. */
export type OsuUserStatistics = {
  pp: number;
  globalRank: number | null;
  countryRank: number | null;
  /** Percent, 0 to 100. */
  accuracy: number;
  playCount: number;
  /** Seconds. */
  playTime: number;
  rankedScore: number;
  totalHits: number;
  maxCombo: number;
  /** Level with its progress as a fraction, e.g. 101.42. */
  level: number;
  grades: { ssh: number; ss: number; sh: number; s: number; a: number };
};

/** A profile: OsuUser plus the main ruleset, a few account facts, and one ruleset's statistics. */
export type OsuUserProfile = OsuUser & {
  playmode: Ruleset | null;
  joinDate: string | null;
  supporter: boolean;
  coverUrl: string | null;
  statistics: OsuUserStatistics;
};

/**
 * @function toOsuUserProfile
 * @param raw {unknown} a /users/{id}/{ruleset} answer
 * @returns {OsuUserProfile} the profile (missing numbers read as 0, missing ranks as null)
 * @throws {z.ZodError} when the answer has no id or username
 */
export const toOsuUserProfile = (raw: unknown): OsuUserProfile => {
  const profile = osuUserProfileSchema.parse(raw);
  const stats = profile.statistics ?? {};
  const grades = stats.grade_counts ?? {};
  const level = stats.level ? stats.level.current + stats.level.progress / 100 : 0;
  return {
    ...toOsuUser(profile),
    playmode: profile.playmode ?? null,
    joinDate: profile.join_date ?? null,
    supporter: profile.is_supporter ?? false,
    coverUrl: profile.cover?.url ?? null,
    statistics: {
      pp: stats.pp ?? 0,
      globalRank: stats.global_rank ?? null,
      countryRank: stats.country_rank ?? null,
      accuracy: stats.hit_accuracy ?? 0,
      playCount: stats.play_count ?? 0,
      playTime: stats.play_time ?? 0,
      rankedScore: stats.ranked_score ?? 0,
      totalHits: stats.total_hits ?? 0,
      maxCombo: stats.maximum_combo ?? 0,
      level,
      grades: {
        ssh: grades.ssh ?? 0,
        ss: grades.ss ?? 0,
        sh: grades.sh ?? 0,
        s: grades.s ?? 0,
        a: grades.a ?? 0,
      },
    },
  };
};
