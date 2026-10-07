/**
 * @file src/client/index.ts
 * @desc The client's public API, re-exported by the root entry point: createOsuClient,
 *       OsuApiError, the option and result types (users and matches included), and the limits. The helpers in this folder stay
 *       private.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Tue Oct 6, 2026
 */

export { createOsuClient, type OsuClient } from "./client.js";
export { OsuApiError, type OsuApiErrorCode } from "./errors.js";
export {
  BEATMAPSET_FALLBACK_LIMIT,
  OSU_BEATMAPS_BATCH_LIMIT,
  OSU_BEATMAPSET_FALLBACK_LIMIT,
  OSU_MATCH_EVENTS_LIMIT,
  OSU_MATCH_PAGE_LIMIT,
  OSU_TIMEOUT_MS,
} from "./options.js";
export { OSU_SCORES_API_VERSION, OSU_SCORES_LIMIT } from "./scores.js";
export type {
  BeatmapDetail,
  BeatmapLookup,
  BeatmapOptions,
  BeatmapScoresOptions,
  BeatmapsetLookup,
  BeatmapsetOptions,
  MatchLookup,
  MatchOptions,
  OsuClientOptions,
  OsuCredentials,
  StarRatingOptions,
  UserLookup,
  UserOptions,
  UserScoresOptions,
  UserScoreType,
  UsersOptions,
} from "./types.js";
