/**
 * @file tests/tournament.test.ts
 * @desc buildLazerBracket against a bracket.json written to osu!lazer's models
 *       (osu.Game.Tournament, serialized with NullValueHandling.Ignore and JsonPointConverter):
 *       keys, defaults, omitted nulls, dates, progressions, and each input it refuses.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type BracketInput,
  buildLazerBracket,
  LAZER_BRACKET_FILENAME,
} from "../src/tournament/index.js";

const fixture = readFileSync(new URL("./fixtures/bracket.json", import.meta.url), "utf8");

/** The list's item at index, which the test knows is there. */
const at = <T>(list: readonly T[], index: number): T => {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${index}`);
  return item;
};

const input = (): BracketInput => ({
  ruleset: "osu",
  teams: [
    {
      name: "Red Team",
      acronym: "RED",
      flag: "JP",
      seed: 1,
      lastYearPlacing: "#2",
      players: [{ id: 2, username: "peppy", country: "au", rank: 1000 }, { id: 3 }],
    },
    { name: "Blue Team", acronym: "BLU", players: [] },
  ],
  rounds: [
    {
      name: "Semifinals",
      description: "Week 1",
      startDate: "2026-10-10T00:00:00Z",
      beatmaps: [
        { id: 75, mods: "NM" },
        { id: 129891, mods: "HD" },
      ],
    },
    { name: "Finals", bestOf: 13, banCount: 2, startDate: new Date("2026-10-17T00:00:00Z") },
  ],
  matches: [
    {
      id: 1,
      round: "Semifinals",
      team1: "RED",
      team2: "BLU",
      team1Score: 5,
      team2Score: 3,
      completed: true,
      date: "2026-10-10T20:00:00+02:00",
      position: { x: 160, y: 100 },
      winnerTo: 2,
      loserTo: 3,
    },
    {
      id: 2,
      round: "Finals",
      team1: "RED",
      current: true,
      date: "2026-10-17T18:00:00Z",
      position: { x: 560, y: 100 },
    },
    { id: 3, round: "Finals", team1: "BLU", losers: true, date: "2026-10-17T20:00:00.500Z" },
  ],
  settings: { playersPerTeam: 2 },
});

describe("buildLazerBracket", () => {
  it("writes lazer's bracket.json", () => {
    const { bracket, json } = buildLazerBracket(input());
    // Same keys in the same order (biome formats the fixture file, so compare the data).
    expect(JSON.stringify(JSON.parse(json))).toBe(JSON.stringify(JSON.parse(fixture)));
    expect(JSON.parse(json)).toEqual(bracket);
    expect(json.endsWith("}\n")).toBe(true);
    expect(LAZER_BRACKET_FILENAME).toBe("bracket.json");
  });

  it("names each ruleset as lazer does", () => {
    const names = (["osu", "taiko", "fruits", "mania"] as const).map(
      (ruleset) => buildLazerBracket({ ...input(), ruleset }).bracket.Ruleset,
    );
    expect(names).toEqual([
      { ShortName: "osu", OnlineID: 0, Name: "osu!" },
      { ShortName: "taiko", OnlineID: 1, Name: "osu!taiko" },
      { ShortName: "fruits", OnlineID: 2, Name: "osu!catch" },
      { ShortName: "mania", OnlineID: 3, Name: "osu!mania" },
    ]);
  });

  it("fills lazer's defaults for an empty ladder", () => {
    expect(
      buildLazerBracket({ ruleset: "mania", teams: [], rounds: [], matches: [] }).bracket,
    ).toMatchObject({
      Matches: [],
      Rounds: [],
      Teams: [],
      Progressions: [],
      ChromaKeyWidth: 1024,
      PlayersPerTeam: 4,
      AutoProgressScreens: true,
      SplitMapPoolByMods: true,
      DisplayTeamSeeds: false,
    });
    const settings = {
      chromaKeyWidth: 1366,
      playersPerTeam: 3,
      autoProgressScreens: false,
      splitMapPoolByMods: false,
      displayTeamSeeds: true,
    };
    expect(
      buildLazerBracket({ ruleset: "osu", teams: [], rounds: [], matches: [], settings }).bracket,
    ).toMatchObject({
      ChromaKeyWidth: 1366,
      PlayersPerTeam: 3,
      AutoProgressScreens: false,
      SplitMapPoolByMods: false,
      DisplayTeamSeeds: true,
    });
  });

  it("refuses input lazer would choke on", () => {
    const cases: [string, (value: BracketInput) => BracketInput][] = [
      ["ruleset", (value) => ({ ...value, ruleset: "catch" as never })],
      ["ruleset", (value) => ({ ...value, ruleset: "toString" as never })],
      ["duplicate team", (value) => ({ ...value, teams: [...value.teams, at(value.teams, 0)] })],
      [
        "player id",
        (value) => ({ ...value, teams: [{ name: "x", acronym: "X", players: [{ id: 0 }] }] }),
      ],
      [
        "duplicate round",
        (value) => ({ ...value, rounds: [...value.rounds, at(value.rounds, 0)] }),
      ],
      [
        "duplicate match",
        (value) => ({ ...value, matches: [...value.matches, at(value.matches, 1)] }),
      ],
      ["match id", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), id: 1.5 }] })],
      ["round", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), round: "Nope" }] })],
      ["team", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), team2: "red" }] })],
      ["winnerTo", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), winnerTo: 9 }] })],
      ["loserTo", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), loserTo: 9 }] })],
      ["date", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), date: "soon" }] })],
      [
        "blank acronym",
        (value) => ({ ...value, teams: [{ name: "x", acronym: "", players: [] }] }),
      ],
      [
        "seed",
        (value) => ({
          ...value,
          teams: [{ name: "x", acronym: "X", seed: Number.NaN, players: [] }],
        }),
      ],
      ["score", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), team1Score: 1.5 }] })],
      [
        "position",
        (value) => ({
          ...value,
          matches: [{ ...at(value.matches, 1), position: { x: Number.NaN, y: 0 } }],
        }),
      ],
      [
        "two current",
        (value) => ({
          ...value,
          matches: [at(value.matches, 1), { ...at(value.matches, 2), current: true }],
        }),
      ],
      ["self loop", (value) => ({ ...value, matches: [{ ...at(value.matches, 1), winnerTo: 2 }] })],
      [
        "bestOf",
        (value) => ({
          ...value,
          rounds: [{ name: "Finals", bestOf: 9.5, startDate: "2026-01-01" }],
        }),
      ],
      ["start date", (value) => ({ ...value, rounds: [{ name: "Finals", startDate: "x" }] })],
    ];
    for (const [name, change] of cases) {
      expect(() => buildLazerBracket(change(input())), name).toThrow(TypeError);
    }
  });

  it("doesn't change its input", () => {
    const value = input();
    const copy = structuredClone(value);
    buildLazerBracket(value);
    expect(value).toEqual(copy);
  });
});
