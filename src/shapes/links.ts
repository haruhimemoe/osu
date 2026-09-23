/**
 * @file src/shapes/links.ts
 * @desc osu! URLs: pages, cover art, and the OAuth endpoints and scopes a "sign in with osu!"
 *       flow uses. Covers are meant to be hotlinked by the browser.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

export const OSU_BASE_URL = "https://osu.ppy.sh";

/** Authorization code flow endpoints (register an app at osu.ppy.sh/home/account/edit#oauth). */
export const OSU_OAUTH = {
  authorizationUrl: `${OSU_BASE_URL}/oauth/authorize`,
  tokenUrl: `${OSU_BASE_URL}/oauth/token`,
  userInfoUrl: `${OSU_BASE_URL}/api/v2/me`,
} as const;

/** `identify` reads /me; `public` reads public data. Sign-in needs `identify`. */
export const OSU_SIGN_IN_SCOPES = ["identify", "public"] as const;

export type CoverSize = "card" | "card@2x" | "list" | "list@2x" | "cover" | "cover@2x";

/**
 * @function coverUrl
 * @param beatmapsetId {number} set id
 * @param size {CoverSize} variant; list is square, card/cover are wide
 * @returns {string} assets.ppy.sh URL
 */
export const coverUrl = (beatmapsetId: number, size: CoverSize = "card"): string =>
  `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/${size}.jpg`;

/**
 * @function beatmapUrl
 * @param beatmapId {number} difficulty id
 * @returns {string} osu! beatmap page
 */
export const beatmapUrl = (beatmapId: number): string => `${OSU_BASE_URL}/beatmaps/${beatmapId}`;

/**
 * @function beatmapsetUrl
 * @param beatmapsetId {number} set id
 * @returns {string} osu! beatmapset page
 */
export const beatmapsetUrl = (beatmapsetId: number): string =>
  `${OSU_BASE_URL}/beatmapsets/${beatmapsetId}`;

/**
 * @function userUrl
 * @param userId {number} osu! user id
 * @returns {string} osu! profile page
 */
export const userUrl = (userId: number): string => `${OSU_BASE_URL}/users/${userId}`;
