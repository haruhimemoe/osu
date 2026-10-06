/**
 * @file src/shapes/match.ts
 * @desc An osu! multiplayer match (an mp link): GET /api/v2/matches/{id} in osu!'s snake_case,
 *       OsuMatch and its events, games and scores in camelCase, and parseMatchId for mp links.
 *       Unknown keys are stripped.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { z } from "zod";
import { type Ruleset, rulesetSchema } from "./beatmap.js";
import { type OsuUser, osuUserSchema, toOsuUser } from "./user.js";

/** The scoring types osu! sends as a game's `scoring_type`. osu! may add more. */
export const MATCH_SCORING_TYPES = ["score", "accuracy", "combo", "scorev2"] as const;
/** The team types osu! sends as a game's `team_type`. osu! may add more. */
export const MATCH_TEAM_TYPES = ["head-to-head", "tag-coop", "team-vs", "tag-team-vs"] as const;

/** A mod as osu! sends it: an acronym ("HD"), or an object with one (newer API versions). */
const modSchema = z.union([z.string(), z.object({ acronym: z.string() })]);

/** One player's score in a game (`game.scores[]`), legacy or newer API format. */
export const osuMatchScoreSchema = z.object({
  user_id: z.number().int().positive(),
  score: z.number().nonnegative().nullish(),
  total_score: z.number().nonnegative().nullish(),
  accuracy: z.number().min(0).max(1),
  max_combo: z.number().int().nonnegative(),
  mods: z.array(modSchema).default([]),
  passed: z.boolean(),
  statistics: z
    .object({
      count_miss: z.number().int().nonnegative().nullish(),
      miss: z.number().int().nonnegative().nullish(),
    })
    .default({}),
  match: z.object({
    slot: z.number().int().nonnegative(),
    team: z.enum(["none", "red", "blue"]),
    pass: z.boolean().nullish(),
  }),
});

/** One game (a map played) in a match. `end_time` is null while it's being played. */
export const osuMatchGameSchema = z.object({
  id: z.number().int().positive(),
  beatmap_id: z.number().int().nonnegative(),
  start_time: z.string(),
  end_time: z.string().nullable(),
  mode: rulesetSchema,
  scoring_type: z.string(),
  team_type: z.string(),
  mods: z.array(modSchema).default([]),
  beatmap: z
    .object({
      id: z.number().int().positive(),
      beatmapset_id: z.number().int().positive(),
      version: z.string(),
    })
    .nullish(),
  scores: z.array(osuMatchScoreSchema).default([]),
});

/** One event in a match's history: a join, a host change, a game, and so on. */
export const osuMatchEventSchema = z.object({
  id: z.number().int().positive(),
  detail: z.object({ type: z.string(), text: z.string().nullish() }),
  timestamp: z.string(),
  user_id: z.number().int().nullish(),
  game: osuMatchGameSchema.nullish(),
});

/** One page of GET /api/v2/matches/{id}: the match, some of its events, and their users. */
export const osuMatchResponseSchema = z.object({
  match: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    start_time: z.string(),
    end_time: z.string().nullish(),
  }),
  events: z.array(osuMatchEventSchema),
  users: z.array(z.unknown()).default([]),
  first_event_id: z.number().int().nonnegative(),
  latest_event_id: z.number().int().nonnegative(),
});

/** A GET /api/v2/matches/{id} page, as osuMatchResponseSchema reads it. */
export type OsuMatchResponse = z.infer<typeof osuMatchResponseSchema>;

/** A score's team: red or blue in team games, "none" in head-to-head. */
export type MatchTeam = "red" | "blue" | "none";

/** One player's score in a game. `accuracy` is 0 to 1; `mods` are acronyms. */
export type MatchScore = {
  userId: number;
  slot: number;
  team: MatchTeam;
  score: number;
  accuracy: number;
  maxCombo: number;
  misses: number;
  mods: string[];
  passed: boolean;
};

/** One game in a match. `endTime` is null while it's being played. */
export type MatchGame = {
  id: number;
  beatmapId: number;
  startTime: string;
  endTime: string | null;
  ruleset: Ruleset;
  /** One of MATCH_SCORING_TYPES, or a newer value. */
  scoringType: string;
  /** One of MATCH_TEAM_TYPES, or a newer value. */
  teamType: string;
  /** The room's mods; in free mod, each score has its own too. */
  mods: string[];
  scores: MatchScore[];
  beatmap: { id: number; beatmapsetId: number; version: string } | null;
};

/** One event in a match. Games come as `type` "other" with `game` set. */
export type MatchEvent = {
  id: number;
  type: string;
  text: string | null;
  timestamp: string;
  userId: number | null;
  game: MatchGame | null;
};

/** An osu! multiplayer match with the events it was read with, oldest first. */
export type OsuMatch = {
  id: number;
  name: string;
  startTime: string;
  endTime: string | null;
  events: MatchEvent[];
  /** The users osu! sent with the events (a user without an id and username is left out). */
  users: OsuUser[];
  /** The id of the match's oldest event, from osu!. */
  firstEventId: number;
  /** The id of the match's newest event, from osu!. */
  latestEventId: number;
};

const toMods = (mods: readonly (string | { acronym: string })[]): string[] =>
  mods.map((mod) => (typeof mod === "string" ? mod : mod.acronym).toUpperCase());

const toScore = (raw: z.infer<typeof osuMatchScoreSchema>): MatchScore => ({
  userId: raw.user_id,
  slot: raw.match.slot,
  team: raw.match.team,
  score: raw.score ?? raw.total_score ?? 0,
  accuracy: raw.accuracy,
  maxCombo: raw.max_combo,
  misses: raw.statistics.count_miss ?? raw.statistics.miss ?? 0,
  mods: toMods(raw.mods),
  passed: raw.passed,
});

const toGame = (raw: z.infer<typeof osuMatchGameSchema>): MatchGame => ({
  id: raw.id,
  beatmapId: raw.beatmap_id,
  startTime: raw.start_time,
  endTime: raw.end_time,
  ruleset: raw.mode,
  scoringType: raw.scoring_type,
  teamType: raw.team_type,
  mods: toMods(raw.mods),
  scores: raw.scores.map(toScore),
  beatmap: raw.beatmap
    ? { id: raw.beatmap.id, beatmapsetId: raw.beatmap.beatmapset_id, version: raw.beatmap.version }
    : null,
});

/**
 * @function toMatchEvent
 * @param raw {z.infer<typeof osuMatchEventSchema>} one parsed event
 * @returns {MatchEvent} the event in camelCase, its game and scores mapped
 */
export const toMatchEvent = (raw: z.infer<typeof osuMatchEventSchema>): MatchEvent => ({
  id: raw.id,
  type: raw.detail.type,
  text: raw.detail.text ?? null,
  timestamp: raw.timestamp,
  userId: raw.user_id ?? null,
  game: raw.game ? toGame(raw.game) : null,
});

/**
 * @function toOsuMatch
 * @param raw {unknown} one GET /api/v2/matches/{id} page
 * @returns {OsuMatch} the match with that page's events, oldest first, and its users
 * @throws {z.ZodError} when the page isn't a match response
 */
export const toOsuMatch = (raw: unknown): OsuMatch => {
  const page = osuMatchResponseSchema.parse(raw);
  const users: OsuUser[] = [];
  for (const user of page.users) {
    if (osuUserSchema.safeParse(user).success) users.push(toOsuUser(user));
  }
  return {
    id: page.match.id,
    name: page.match.name,
    startTime: page.match.start_time,
    endTime: page.match.end_time ?? null,
    events: page.events.map(toMatchEvent).sort((a, b) => a.id - b.id),
    users,
    firstEventId: page.first_event_id,
    latestEventId: page.latest_event_id,
  };
};

const MATCH_PATH = /^\/(?:community\/matches|mp)\/(\d+)\/?$/;

/**
 * @function parseMatchId
 * @param input {number | string} a match id, or an mp link
 *        (`https://osu.ppy.sh/community/matches/123` or `osu.ppy.sh/mp/123`)
 * @returns {number | null} the match id, or null when the input is neither
 */
export const parseMatchId = (input: number | string): number | null => {
  if (typeof input === "number") return Number.isSafeInteger(input) && input > 0 ? input : null;
  const text = input.trim();
  if (/^\d+$/.test(text)) return parseMatchId(Number(text));
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^(?:www\.)?osu\.ppy\.sh$/i.test(url.hostname)) return null;
  const id = MATCH_PATH.exec(url.pathname)?.[1];
  return id === undefined ? null : parseMatchId(Number(id));
};
