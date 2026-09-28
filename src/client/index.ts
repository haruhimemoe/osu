/**
 * @file src/client/index.ts
 * @desc The client's public API, re-exported by the root entry point: createOsuClient,
 *       OsuApiError, the option and result types, and the limits. The helpers in this folder stay
 *       private.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

export { createOsuClient, type OsuClient } from "./client.js";
export { OsuApiError, type OsuApiErrorCode } from "./errors.js";
export {
  BEATMAPSET_FALLBACK_LIMIT,
  OSU_BEATMAPS_BATCH_LIMIT,
  OSU_BEATMAPSET_FALLBACK_LIMIT,
  OSU_TIMEOUT_MS,
} from "./options.js";
export type {
  BeatmapLookup,
  BeatmapOptions,
  BeatmapsetLookup,
  BeatmapsetOptions,
  OsuClientOptions,
  OsuCredentials,
  StarRatingOptions,
} from "./types.js";
