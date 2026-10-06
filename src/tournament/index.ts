/**
 * @file src/tournament/index.ts
 * @desc @haruhimemoe/osu/tournament: buildLazerBracket writes the osu!lazer tournament client's
 *       bracket.json from plain input. The keys follow osu.Game.Tournament's models as lazer
 *       serializes them (PascalCase, nulls left out, Position as { X, Y }). Pure, imports nothing at
 *       runtime, so it runs in browsers.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import type { Ruleset } from "../shapes/beatmap.js";

/** A player on a team. lazer fills in a missing name, country or rank from osu! on load. */
export type BracketPlayer = {
  /** osu! user id. */
  id: number;
  username?: string | undefined;
  /** Two-letter country code, e.g. "JP". */
  country?: string | undefined;
  /** Global rank in the bracket's ruleset. */
  rank?: number | undefined;
};

/** A team. Matches name teams by acronym, which lazer compares with case. */
export type BracketTeam = {
  name: string;
  acronym: string;
  /** The flag lazer shows: a country code ("JP") or a custom flag's name. Default "". */
  flag?: string | undefined;
  /** Shown when DisplayTeamSeeds is on. Default "". */
  seed?: string | number | undefined;
  /** Default "N/A". */
  lastYearPlacing?: string | undefined;
  players: readonly BracketPlayer[];
};

/** A map in a round's pool. */
export type BracketBeatmap = {
  /** Beatmap (difficulty) id. lazer fetches the map's details from osu! by it. */
  id: number;
  /** The pool slot's mod group, e.g. "NM", "HD", "HR", "DT", "FM", "TB". */
  mods: string;
};

/** A round (Quarterfinals, Grand Finals...). */
export type BracketRound = {
  name: string;
  description?: string | undefined;
  /** Default 9. */
  bestOf?: number | undefined;
  /** Default 1. */
  banCount?: number | undefined;
  /** An ISO date-time or a Date. */
  startDate: string | Date;
  beatmaps?: readonly BracketBeatmap[] | undefined;
};

/** A match in the bracket. */
export type BracketMatch = {
  /** Unique within the bracket. */
  id: number;
  /** The name of its round in `rounds`. */
  round: string;
  /** Team acronyms; leave out while the side isn't known yet. */
  team1?: string | undefined;
  team2?: string | undefined;
  /** Scores; leave out before the match starts. */
  team1Score?: number | undefined;
  team2Score?: number | undefined;
  completed?: boolean | undefined;
  /** In the losers bracket. */
  losers?: boolean | undefined;
  /** The match lazer opens on. At most one should be. */
  current?: boolean | undefined;
  /** An ISO date-time or a Date. */
  date: string | Date;
  /** Where the bracket screen draws it. Default { x: 0, y: 0 }. */
  position?: { x: number; y: number } | undefined;
  /** The match the winner moves to. */
  winnerTo?: number | undefined;
  /** The match the loser moves to (losers bracket). */
  loserTo?: number | undefined;
};

/** Ladder-wide settings. Defaults are lazer's. */
export type BracketSettings = {
  /** Default 1024. */
  chromaKeyWidth?: number | undefined;
  /** Default 4. */
  playersPerTeam?: number | undefined;
  /** Default true. */
  autoProgressScreens?: boolean | undefined;
  /** Default true. */
  splitMapPoolByMods?: boolean | undefined;
  /** Default false. */
  displayTeamSeeds?: boolean | undefined;
};

/** buildLazerBracket's input. */
export type BracketInput = {
  ruleset: Ruleset;
  teams: readonly BracketTeam[];
  rounds: readonly BracketRound[];
  matches: readonly BracketMatch[];
  settings?: BracketSettings | undefined;
};

/** One player in bracket.json. */
export type LazerBracketPlayer = {
  id: number;
  Username?: string;
  country_code?: string;
  Rank?: number;
};

/** One team in bracket.json. */
export type LazerBracketTeam = {
  FullName: string;
  FlagName: string;
  Acronym: string;
  SeedingResults: [];
  Seed: string;
  LastYearPlacing: string;
  Players: LazerBracketPlayer[];
};

/** One round in bracket.json. */
export type LazerBracketRound = {
  Name: string;
  Description: string;
  BestOf: number;
  BanCount: number;
  Beatmaps: { ID: number; Mods: string }[];
  StartDate: string;
  Matches: number[];
};

/** One match in bracket.json. */
export type LazerBracketMatch = {
  ID: number;
  Team1Acronym?: string;
  Team2Acronym?: string;
  Team1Score?: number;
  Team2Score?: number;
  Completed: boolean;
  Losers: boolean;
  PicksBans: [];
  Current: boolean;
  Date: string;
  ConditionalMatches: [];
  Position: { X: number; Y: number };
};

/** osu!lazer's bracket.json (osu.Game.Tournament's LadderInfo). */
export type LazerBracket = {
  Ruleset: { ShortName: Ruleset; OnlineID: number; Name: string };
  Matches: LazerBracketMatch[];
  Rounds: LazerBracketRound[];
  Teams: LazerBracketTeam[];
  Progressions: { SourceID: number; TargetID: number; Losers?: true }[];
  ChromaKeyWidth: number;
  PlayersPerTeam: number;
  AutoProgressScreens: boolean;
  SplitMapPoolByMods: boolean;
  DisplayTeamSeeds: boolean;
};

/** The file name lazer reads, in its tournament folder. */
export const LAZER_BRACKET_FILENAME = "bracket.json";

const RULESET_INFO: Record<Ruleset, { OnlineID: number; Name: string }> = {
  osu: { OnlineID: 0, Name: "osu!" },
  taiko: { OnlineID: 1, Name: "osu!taiko" },
  fruits: { OnlineID: 2, Name: "osu!catch" },
  mania: { OnlineID: 3, Name: "osu!mania" },
};

/** An ISO date-time the way lazer's Newtonsoft writes a DateTimeOffset, in UTC. */
const toLazerDate = (value: string | Date, field: string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} isn't a valid date.`);
  return `${date.toISOString().slice(0, 19)}+00:00`;
};

const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * @function buildLazerBracket
 * @param input {BracketInput} ruleset, teams with players, rounds with their pools, matches with
 *        sides, times, scores and where winners and losers go, and optional ladder settings
 * @returns {{ bracket: LazerBracket; json: string }} the bracket.json object and its text
 *          (indented, ending in a newline), to save as `tournament/bracket.json` in lazer's
 *          tournament storage. Pick/ban, seeding results and map details are left for lazer
 * @throws {TypeError} on an unknown ruleset; a blank or duplicate team acronym; a duplicate round
 *         name or match id; a seed that isn't finite; an id, score, position, bestOf or banCount
 *         that isn't an integer; more than one current match; a match naming an unknown round or
 *         team; a winnerTo or loserTo naming the match itself or an unknown match; or a date that
 *         isn't valid
 */
export const buildLazerBracket = (input: BracketInput): { bracket: LazerBracket; json: string } => {
  const ruleset = RULESET_INFO[input.ruleset];
  if (!Object.hasOwn(RULESET_INFO, input.ruleset) || !ruleset) {
    throw new TypeError(`Unknown ruleset "${String(input.ruleset)}".`);
  }
  const acronyms = new Set<string>();
  const teams = input.teams.map((team): LazerBracketTeam => {
    if (team.acronym === "") throw new TypeError("A team acronym must not be blank.");
    if (team.seed !== undefined && typeof team.seed === "number" && !Number.isFinite(team.seed)) {
      throw new TypeError(`Team "${team.acronym}" has an invalid seed.`);
    }
    if (acronyms.has(team.acronym)) throw new TypeError(`Duplicate team "${team.acronym}".`);
    acronyms.add(team.acronym);
    return {
      FullName: team.name,
      FlagName: team.flag ?? "",
      Acronym: team.acronym,
      SeedingResults: [],
      Seed: team.seed === undefined ? "" : String(team.seed),
      LastYearPlacing: team.lastYearPlacing ?? "N/A",
      Players: team.players.map((player) => {
        if (!isInteger(player.id) || player.id < 1) {
          throw new TypeError(`A player on "${team.acronym}" has an invalid id.`);
        }
        return {
          id: player.id,
          ...(player.username === undefined ? {} : { Username: player.username }),
          ...(player.country === undefined ? {} : { country_code: player.country.toUpperCase() }),
          ...(player.rank === undefined ? {} : { Rank: player.rank }),
        };
      }),
    };
  });

  const ids = new Set<number>();
  for (const match of input.matches) {
    if (!isInteger(match.id)) throw new TypeError("A match id must be an integer.");
    if (ids.has(match.id)) throw new TypeError(`Duplicate match ${match.id}.`);
    ids.add(match.id);
  }

  const roundMatches = new Map<string, number[]>();
  for (const round of input.rounds) {
    if (roundMatches.has(round.name)) throw new TypeError(`Duplicate round "${round.name}".`);
    roundMatches.set(round.name, []);
  }

  const progressions: LazerBracket["Progressions"] = [];
  let currents = 0;
  const matches = input.matches.map((match): LazerBracketMatch => {
    const inRound = roundMatches.get(match.round);
    if (!inRound) throw new TypeError(`Match ${match.id} names an unknown round.`);
    inRound.push(match.id);
    for (const [field, value] of [
      ["team1Score", match.team1Score],
      ["team2Score", match.team2Score],
      ["position.x", match.position?.x],
      ["position.y", match.position?.y],
    ] as const) {
      if (value !== undefined && !isInteger(value)) {
        throw new TypeError(`Match ${match.id}'s ${field} must be an integer.`);
      }
    }
    if (match.current) currents += 1;
    if (currents > 1) throw new TypeError("At most one match can be current.");
    for (const acronym of [match.team1, match.team2]) {
      if (acronym !== undefined && !acronyms.has(acronym)) {
        throw new TypeError(`Match ${match.id} names an unknown team.`);
      }
    }
    for (const [target, losers] of [
      [match.winnerTo, false],
      [match.loserTo, true],
    ] as const) {
      if (target === undefined) continue;
      if (target === match.id) throw new TypeError(`Match ${match.id} moves to itself.`);
      if (!ids.has(target)) throw new TypeError(`Match ${match.id} moves to an unknown match.`);
      progressions.push({
        SourceID: match.id,
        TargetID: target,
        ...(losers ? { Losers: true as const } : {}),
      });
    }
    return {
      ID: match.id,
      ...(match.team1 === undefined ? {} : { Team1Acronym: match.team1 }),
      ...(match.team2 === undefined ? {} : { Team2Acronym: match.team2 }),
      ...(match.team1Score === undefined ? {} : { Team1Score: match.team1Score }),
      ...(match.team2Score === undefined ? {} : { Team2Score: match.team2Score }),
      Completed: match.completed ?? false,
      Losers: match.losers ?? false,
      PicksBans: [],
      Current: match.current ?? false,
      Date: toLazerDate(match.date, `Match ${match.id}'s date`),
      ConditionalMatches: [],
      Position: { X: match.position?.x ?? 0, Y: match.position?.y ?? 0 },
    };
  });

  for (const round of input.rounds) {
    for (const value of [round.bestOf, round.banCount]) {
      if (value !== undefined && !isInteger(value)) {
        throw new TypeError(`Round "${round.name}"'s bestOf and banCount must be integers.`);
      }
    }
  }
  const rounds = input.rounds.map(
    (round): LazerBracketRound => ({
      Name: round.name,
      Description: round.description ?? "",
      BestOf: round.bestOf ?? 9,
      BanCount: round.banCount ?? 1,
      Beatmaps: (round.beatmaps ?? []).map((map) => ({ ID: map.id, Mods: map.mods })),
      StartDate: toLazerDate(round.startDate, `Round "${round.name}"'s start date`),
      Matches: roundMatches.get(round.name) ?? [],
    }),
  );

  const settings = input.settings ?? {};
  const bracket: LazerBracket = {
    Ruleset: { ShortName: input.ruleset, ...ruleset },
    Matches: matches,
    Rounds: rounds,
    Teams: teams,
    Progressions: progressions,
    ChromaKeyWidth: settings.chromaKeyWidth ?? 1024,
    PlayersPerTeam: settings.playersPerTeam ?? 4,
    AutoProgressScreens: settings.autoProgressScreens ?? true,
    SplitMapPoolByMods: settings.splitMapPoolByMods ?? true,
    DisplayTeamSeeds: settings.displayTeamSeeds ?? false,
  };
  return { bracket, json: `${JSON.stringify(bracket, null, 2)}\n` };
};
