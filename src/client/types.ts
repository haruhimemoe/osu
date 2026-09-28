/**
 * @file src/client/types.ts
 * @desc The client's public option and result types: credentials, createOsuClient's options, and
 *       each method's options and result.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Mon Sep 28, 2026
 */

import type { BeatmapMeta } from "../shapes/beatmap.js";
import type { OsuBeatmapsetExtended } from "../shapes/beatmapset.js";

/** An OAuth app's id and secret, from osu.ppy.sh/home/account/edit#oauth. */
export type OsuCredentials = { clientId: string; clientSecret: string };

/** createOsuClient's options. Only `credentials` and `userAgent` are required. */
export type OsuClientOptions = {
  /**
   * The OAuth app's id and secret (non-empty strings), or a function returning them. A function is
   * called on every token request (the first call, each refresh, and after a 401), never at import,
   * so a rotated secret is picked up. Its errors reach you unchanged.
   */
  credentials: OsuCredentials | (() => OsuCredentials);
  /** Sent on every request, e.g. "my-tool (+https://example.com; me@example.com)". */
  userAgent: string;
  /**
   * Default https://osu.ppy.sh. Token requests go here too, so this server receives your client
   * secret: point it only at osu! itself or your own test server, never at a mirror. Must be
   * https, or http on localhost / 127.0.0.1.
   */
  baseUrl?: string | undefined;
  /**
   * How long one request (answer and body) may take before it fails. An integer from 1 to
   * 2_147_483_647. Default OSU_TIMEOUT_MS (10 s).
   */
  timeoutMs?: number | undefined;
  /** Replaces globalThis.fetch for every request, token requests included (tests, proxies). */
  fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  /** Clock for token expiry and for turning a Retry-After date into retryAfterMs (tests). */
  now?: (() => number) | undefined;
};

/**
 * Difficulties osu! knows (`found`), ids it doesn't (`missing`), and ids we couldn't check
 * (`unchecked`: beforeCall refused their batch, or osu!'s row for them failed the schema).
 */
export type BeatmapLookup = {
  found: Map<number, BeatmapMeta>;
  missing: number[];
  unchecked: number[];
};

/** Options every method takes. getBeatmaps takes exactly these. */
export type BeatmapOptions = {
  /**
   * Your rate budget: asked before each planned osu! API call; false skips that call. Not asked
   * for token requests or for the one retry after a 401. Default: always call (unlimited). Its
   * errors reach you unchanged.
   */
  beforeCall?: (() => Promise<boolean>) | undefined;
};

/** Options for getStarRating. */
export type StarRatingOptions = BeatmapOptions;

/**
 * Beatmapsets plus ids left unchecked (see getBeatmapsets for exactly when). Ids osu! doesn't know
 * are in neither.
 */
export type BeatmapsetLookup = {
  /** Keyed by beatmap (difficulty) id, not set id; sibling difficulties share one set object. */
  sets: Map<number, OsuBeatmapsetExtended>;
  unchecked: number[];
};

/** Options for getBeatmapsets. */
export type BeatmapsetOptions = BeatmapOptions & {
  /**
   * At most this many /beatmapsets/{id} fallback calls. Default OSU_BEATMAPSET_FALLBACK_LIMIT (10).
   */
  fallbackLimit?: number | undefined;
};
