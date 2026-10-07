/**
 * @file src/client/types.ts
 * @desc The client's public option and result types: credentials, createOsuClient's options, and
 *       each method's options and result.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Oct 6, 2026
 */

import type { BeatmapMeta, Ruleset } from "../shapes/beatmap.js";
import type { OsuBeatmapsetExtended } from "../shapes/beatmapset.js";
import type { OsuMatch } from "../shapes/match.js";
import type { OsuUser } from "../shapes/user.js";

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

/** Options for getUser. */
export type UserOptions = BeatmapOptions & {
  /** The ruleset whose stats osu! answers with (default: the user's own). Doesn't change who. */
  ruleset?: Ruleset | undefined;
};

/** Options for getUsers. */
export type UsersOptions = BeatmapOptions;

/**
 * Users osu! knows (`found`), ids it doesn't (`missing`), and ids we couldn't check
 * (`unchecked`: beforeCall refused their batch, or osu!'s user for them failed the schema).
 */
export type UserLookup = {
  found: Map<number, OsuUser>;
  missing: number[];
  unchecked: number[];
};

/** Options for getMatch. */
export type MatchOptions = BeatmapOptions & {
  /** At most this many pages of 100 events per call. Default OSU_MATCH_PAGE_LIMIT (50). */
  maxPages?: number | undefined;
};

/**
 * A match and whether it's whole: `complete` is false when maxPages ran out or beforeCall refused
 * a page, and `match.events` then holds only the newest events.
 */
export type MatchLookup = { match: OsuMatch; complete: boolean };

/** getUserScores' list: top plays, the last 24 hours, or global #1s. */
export type UserScoreType = "best" | "recent" | "firsts";

/** Options for getUserScores. */
export type UserScoresOptions = BeatmapOptions & {
  /** The ruleset whose scores to list (default: the user's main one). */
  ruleset?: Ruleset | undefined;
  /** 1 to OSU_SCORES_LIMIT (100). Default: osu!'s own. */
  limit?: number | undefined;
  /** Scores to skip, for paging. */
  offset?: number | undefined;
  /** "recent" only: include failed plays. Default false. */
  includeFails?: boolean | undefined;
};

/** Options for getBeatmapScores and getBeatmapUserScores. */
export type BeatmapScoresOptions = BeatmapOptions & {
  /** The ruleset to read (a convert's), default the map's own. */
  ruleset?: Ruleset | undefined;
  /** getBeatmapScores only: 1 to OSU_SCORES_LIMIT (100). */
  limit?: number | undefined;
};

/** One difficulty from getBeatmap: its metadata, max combo, and ranked status ("ranked", "loved", ...). */
export type BeatmapDetail = BeatmapMeta & { maxCombo: number | null; status: string | null };
