/**
 * @file src/shapes/user.ts
 * @desc The osu! user an app signs in: GET /api/v2/me reduced to id, username, avatar and
 *       country. osu! never shares an email; key accounts on the osu! id.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { z } from "zod";

export const osuUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  avatar_url: z.string().nullish(),
  country_code: z.string().nullish(),
  country: z.object({ code: z.string().nullish() }).nullish(),
});

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
