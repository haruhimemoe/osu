/**
 * @file tests/types.test.ts
 * @desc The type-only half of the public API, which tests/exports.test.ts can't see at runtime:
 *       every documented type, imported from each entry point that should export it, with its
 *       shape pinned. `bun run typecheck` checks these (expectTypeOf does nothing at runtime), so
 *       dropping an `export` or changing a documented shape fails the check.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Tue Oct 6, 2026
 */

import { describe, expectTypeOf, it } from "vitest";
import type * as Collections from "../src/collections/index.js";
import type * as Format from "../src/format/index.js";
import type * as Root from "../src/index.js";
import type * as Match from "../src/match/index.js";
import type * as Shapes from "../src/shapes/index.js";
import type * as Tournament from "../src/tournament/index.js";

describe("client types, from the root", () => {
  it("pins the options", () => {
    expectTypeOf<Root.OsuCredentials>().toEqualTypeOf<{ clientId: string; clientSecret: string }>();
    expectTypeOf<Root.OsuClientOptions>().toEqualTypeOf<{
      credentials: Root.OsuCredentials | (() => Root.OsuCredentials);
      userAgent: string;
      baseUrl?: string | undefined;
      timeoutMs?: number | undefined;
      fetch?: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
      now?: (() => number) | undefined;
    }>();
    expectTypeOf<Root.BeatmapOptions>().toEqualTypeOf<{
      beforeCall?: (() => Promise<boolean>) | undefined;
    }>();
    expectTypeOf<Root.StarRatingOptions>().toEqualTypeOf<Root.BeatmapOptions>();
    expectTypeOf<Root.BeatmapsetOptions>().toEqualTypeOf<
      Root.BeatmapOptions & { fallbackLimit?: number | undefined }
    >();
    expectTypeOf<Root.UserOptions>().toEqualTypeOf<
      Root.BeatmapOptions & { ruleset?: Root.Ruleset | undefined }
    >();
    expectTypeOf<Root.UsersOptions>().toEqualTypeOf<Root.BeatmapOptions>();
  });

  it("pins the results and the client", () => {
    expectTypeOf<Root.BeatmapLookup>().toEqualTypeOf<{
      found: Map<number, Root.BeatmapMeta>;
      missing: number[];
      unchecked: number[];
    }>();
    expectTypeOf<Root.BeatmapsetLookup>().toEqualTypeOf<{
      sets: Map<number, Root.OsuBeatmapsetExtended>;
      unchecked: number[];
    }>();
    expectTypeOf<Root.OsuClient>().toEqualTypeOf<ReturnType<typeof Root.createOsuClient>>();
    expectTypeOf<Root.OsuClient["getBeatmaps"]>().toEqualTypeOf<
      (ids: readonly number[], options?: Root.BeatmapOptions) => Promise<Root.BeatmapLookup>
    >();
    expectTypeOf<Root.OsuClient["getBeatmapsets"]>().toEqualTypeOf<
      (ids: readonly number[], options?: Root.BeatmapsetOptions) => Promise<Root.BeatmapsetLookup>
    >();
    expectTypeOf<Root.OsuClient["getStarRating"]>().toEqualTypeOf<
      (
        beatmapId: number,
        mods: readonly string[],
        options?: Root.StarRatingOptions,
      ) => Promise<number | null>
    >();
    expectTypeOf<Root.UserLookup>().toEqualTypeOf<{
      found: Map<number, Root.OsuUser>;
      missing: number[];
      unchecked: number[];
    }>();
    expectTypeOf<Root.OsuClient["getUser"]>().toEqualTypeOf<
      (user: number | string, options?: Root.UserOptions) => Promise<Root.OsuUser | null>
    >();
    expectTypeOf<Root.OsuClient["getUsers"]>().toEqualTypeOf<
      (ids: readonly number[], options?: Root.UsersOptions) => Promise<Root.UserLookup>
    >();
  });

  it("pins the error", () => {
    expectTypeOf<
      "timeout" | "network" | "bad_response" | "http_error" | "budget"
    >().toExtend<Root.OsuApiErrorCode>();
    expectTypeOf<Root.OsuApiError["code"]>().toEqualTypeOf<Root.OsuApiErrorCode>();
    expectTypeOf<Root.OsuApiError["status"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Root.OsuApiError["retryAfterMs"]>().toEqualTypeOf<number | null>();
  });
});

describe("shape types, from /shapes and the root", () => {
  it("pins the beatmap types", () => {
    expectTypeOf<Shapes.Ruleset>().toEqualTypeOf<"osu" | "taiko" | "fruits" | "mania">();
    expectTypeOf<Shapes.BeatmapMeta>().toEqualTypeOf<{
      beatmapId: number;
      beatmapsetId: number;
      mode: Shapes.Ruleset;
      title: string;
      artist: string;
      version: string;
      creator: string;
      creatorId: number | null;
      cs: number;
      ar: number;
      od: number;
      hp: number;
      bpm: number;
      lengthSeconds: number;
      starRating: number;
      checksum: string | null;
    }>();
    expectTypeOf<Shapes.OsuBeatmapRow>().toEqualTypeOf<
      ReturnType<typeof Shapes.osuBeatmapRowSchema.parse>
    >();
    expectTypeOf<Shapes.OsuBeatmapRow["beatmapset"]["user_id"]>().toEqualTypeOf<
      number | null | undefined
    >();
  });

  it("pins the beatmapset, user and link types", () => {
    expectTypeOf<Shapes.OsuBeatmapset>().toEqualTypeOf<
      ReturnType<typeof Shapes.osuBeatmapsetSchema.parse>
    >();
    expectTypeOf<Shapes.OsuBeatmapsetExtended>().toExtend<Shapes.OsuBeatmapset>();
    expectTypeOf<Shapes.OsuBeatmapsetExtended["track_id"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Shapes.OsuBeatmapsetExtended["tags"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Shapes.OsuUser>().toEqualTypeOf<{
      osuId: number;
      username: string;
      avatarUrl: string | null;
      countryCode: string | null;
    }>();
    expectTypeOf<Shapes.CoverSize>().toEqualTypeOf<
      "card" | "card@2x" | "list" | "list@2x" | "cover" | "cover@2x"
    >();
  });

  it("re-exports every shape type from the root", () => {
    expectTypeOf<Root.Ruleset>().toEqualTypeOf<Shapes.Ruleset>();
    expectTypeOf<Root.BeatmapMeta>().toEqualTypeOf<Shapes.BeatmapMeta>();
    expectTypeOf<Root.OsuBeatmapRow>().toEqualTypeOf<Shapes.OsuBeatmapRow>();
    expectTypeOf<Root.OsuBeatmapset>().toEqualTypeOf<Shapes.OsuBeatmapset>();
    expectTypeOf<Root.OsuBeatmapsetExtended>().toEqualTypeOf<Shapes.OsuBeatmapsetExtended>();
    expectTypeOf<Root.OsuUser>().toEqualTypeOf<Shapes.OsuUser>();
    expectTypeOf<Root.CoverSize>().toEqualTypeOf<Shapes.CoverSize>();
  });
});

describe("collection types, from /collections and the root", () => {
  it("pins the model and the reader's types", () => {
    expectTypeOf<Collections.OsuCollection>().toEqualTypeOf<{
      name: string;
      hashes: readonly string[];
    }>();
    expectTypeOf<Collections.CollectionDb>().toEqualTypeOf<{
      version: number;
      collections: readonly Collections.OsuCollection[];
    }>();
    expectTypeOf<Collections.ReadCollectionDbOptions>().toEqualTypeOf<{
      maxBytes?: number | undefined;
      lenient?: boolean | undefined;
    }>();
    expectTypeOf<Collections.CollectionDbWarning>().toEqualTypeOf<{
      code: Collections.CollectionDbWarningCode;
      offset: number;
      collection: number | null;
      hash: number | null;
    }>();
    expectTypeOf<
      "null_name" | "duplicate_hash" | "trailing_bytes"
    >().toExtend<Collections.CollectionDbWarningCode>();
    expectTypeOf<Collections.CollectionDbRead>().toEqualTypeOf<
      Collections.CollectionDb & {
        warnings: readonly Collections.CollectionDbWarning[];
        omittedWarnings: number;
      }
    >();
    expectTypeOf<
      "truncated" | "invalid_name" | "invalid_hash"
    >().toExtend<Collections.CollectionDbErrorCode>();
    expectTypeOf<
      Collections.CollectionDbError["code"]
    >().toEqualTypeOf<Collections.CollectionDbErrorCode>();
  });

  it("pins the writer's and the helpers' types", () => {
    expectTypeOf<Collections.WriteCollectionDbOptions>().toEqualTypeOf<{
      maxBytes?: number | undefined;
    }>();
    expectTypeOf<Collections.CollectionHashes<{ id: number }>>().toEqualTypeOf<{
      hashes: string[];
      withoutChecksum: { id: number }[];
    }>();
    expectTypeOf<Collections.AddToCollectionResult>().toEqualTypeOf<{
      db: Collections.CollectionDb;
      index: number;
      created: boolean;
      added: number;
      alreadyPresent: number;
      similarName: string | null;
    }>();
    expectTypeOf<Collections.MergeCollectionsResult>().toEqualTypeOf<{
      db: Collections.CollectionDb;
      created: number;
      added: number;
      alreadyPresent: number;
      invalid: number;
    }>();
    expectTypeOf<Collections.LazerImportFile>().toEqualTypeOf<{
      path: string;
      bytes: Uint8Array<ArrayBuffer>;
    }>();
    expectTypeOf<ReturnType<typeof Collections.lazerImportFiles>>().toEqualTypeOf<
      Collections.LazerImportFile[]
    >();
  });

  it("re-exports every collection type from the root", () => {
    expectTypeOf<Root.OsuCollection>().toEqualTypeOf<Collections.OsuCollection>();
    expectTypeOf<Root.CollectionDb>().toEqualTypeOf<Collections.CollectionDb>();
    expectTypeOf<Root.CollectionDbRead>().toEqualTypeOf<Collections.CollectionDbRead>();
    expectTypeOf<Root.CollectionDbWarning>().toEqualTypeOf<Collections.CollectionDbWarning>();
    expectTypeOf<Root.CollectionDbWarningCode>().toEqualTypeOf<Collections.CollectionDbWarningCode>();
    expectTypeOf<Root.CollectionDbErrorCode>().toEqualTypeOf<Collections.CollectionDbErrorCode>();
    expectTypeOf<Root.ReadCollectionDbOptions>().toEqualTypeOf<Collections.ReadCollectionDbOptions>();
    expectTypeOf<Root.WriteCollectionDbOptions>().toEqualTypeOf<Collections.WriteCollectionDbOptions>();
    expectTypeOf<Root.CollectionHashes<string>>().toEqualTypeOf<
      Collections.CollectionHashes<string>
    >();
    expectTypeOf<Root.AddToCollectionResult>().toEqualTypeOf<Collections.AddToCollectionResult>();
    expectTypeOf<Root.MergeCollectionsResult>().toEqualTypeOf<Collections.MergeCollectionsResult>();
    expectTypeOf<Root.LazerImportFile>().toEqualTypeOf<Collections.LazerImportFile>();
  });
});

describe("/format signatures", () => {
  it("takes numbers and returns strings", () => {
    type OneNumber = (value: number) => string;
    expectTypeOf<typeof Format.formatDuration>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatLongDuration>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatStars>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatBpm>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatStat>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatBytes>().toEqualTypeOf<OneNumber>();
    expectTypeOf<typeof Format.formatRange>().toEqualTypeOf<
      (low: number, high: number, format: (n: number) => string) => string
    >();
    expectTypeOf<typeof Root.formatStars>().toEqualTypeOf<typeof Format.formatStars>();
  });
});

describe("match types, from /shapes, /match, /tournament and the root", () => {
  it("pins the client's match options and result", () => {
    expectTypeOf<Root.MatchOptions>().toEqualTypeOf<
      Root.BeatmapOptions & { maxPages?: number | undefined }
    >();
    expectTypeOf<Root.MatchLookup>().toEqualTypeOf<{ match: Root.OsuMatch; complete: boolean }>();
    expectTypeOf<Root.OsuClient["getMatch"]>().toEqualTypeOf<
      (match: number | string, options?: Root.MatchOptions) => Promise<Root.MatchLookup | null>
    >();
  });

  it("pins the match shapes", () => {
    expectTypeOf<Shapes.MatchTeam>().toEqualTypeOf<"red" | "blue" | "none">();
    expectTypeOf<Shapes.MatchScore>().toEqualTypeOf<{
      userId: number;
      slot: number;
      team: Shapes.MatchTeam;
      score: number;
      accuracy: number;
      maxCombo: number;
      misses: number;
      mods: string[];
      passed: boolean;
    }>();
    expectTypeOf<Shapes.MatchGame>().toEqualTypeOf<{
      id: number;
      beatmapId: number;
      startTime: string;
      endTime: string | null;
      ruleset: Shapes.Ruleset;
      scoringType: string;
      teamType: string;
      mods: string[];
      scores: Shapes.MatchScore[];
      beatmap: { id: number; beatmapsetId: number; version: string } | null;
    }>();
    expectTypeOf<Shapes.MatchEvent>().toEqualTypeOf<{
      id: number;
      type: string;
      text: string | null;
      timestamp: string;
      userId: number | null;
      game: Shapes.MatchGame | null;
    }>();
    expectTypeOf<Shapes.OsuMatch>().toEqualTypeOf<{
      id: number;
      name: string;
      startTime: string;
      endTime: string | null;
      events: Shapes.MatchEvent[];
      users: Shapes.OsuUser[];
      firstEventId: number;
      latestEventId: number;
    }>();
    expectTypeOf<Shapes.OsuMatchResponse>().toEqualTypeOf<
      ReturnType<typeof Shapes.osuMatchResponseSchema.parse>
    >();
    expectTypeOf<typeof Shapes.parseMatchId>().toEqualTypeOf<
      (input: number | string) => number | null
    >();
  });

  it("pins the /match helper types", () => {
    expectTypeOf<Match.MatchSide>().toEqualTypeOf<"red" | "blue" | number>();
    expectTypeOf<Match.GameStatus>().toEqualTypeOf<"in_progress" | "aborted" | "completed">();
    expectTypeOf<Match.WinCondition>().toEqualTypeOf<"score" | "accuracy" | "combo">();
    expectTypeOf<Match.GameWinnerOptions>().toEqualTypeOf<{
      by?: Match.WinCondition | undefined;
      passedOnly?: boolean | undefined;
    }>();
    expectTypeOf<Match.ListGamesOptions>().toEqualTypeOf<{ warmups?: number | undefined }>();
    expectTypeOf<Match.MapWinsOptions>().toEqualTypeOf<
      Match.ListGamesOptions & Match.GameWinnerOptions
    >();
    expectTypeOf<Match.GameResult>().toEqualTypeOf<{
      winner: Match.MatchSide | null;
      totals: Map<Match.MatchSide, number>;
    }>();
    expectTypeOf<Root.GameResult>().toEqualTypeOf<Match.GameResult>();
  });

  it("pins the /tournament types", () => {
    expectTypeOf<Tournament.BracketPlayer>().toEqualTypeOf<{
      id: number;
      username?: string | undefined;
      country?: string | undefined;
      rank?: number | undefined;
    }>();
    expectTypeOf<Tournament.BracketInput>().toEqualTypeOf<{
      ruleset: Shapes.Ruleset;
      teams: readonly Tournament.BracketTeam[];
      rounds: readonly Tournament.BracketRound[];
      matches: readonly Tournament.BracketMatch[];
      settings?: Tournament.BracketSettings | undefined;
    }>();
    expectTypeOf<Tournament.BracketBeatmap>().toEqualTypeOf<{ id: number; mods: string }>();
    expectTypeOf<Tournament.LazerBracket["Progressions"]>().toEqualTypeOf<
      { SourceID: number; TargetID: number; Losers?: true }[]
    >();
    expectTypeOf<Tournament.LazerBracketMatch["Position"]>().toEqualTypeOf<{
      X: number;
      Y: number;
    }>();
    expectTypeOf<Tournament.LazerBracketTeam["Players"]>().toEqualTypeOf<
      Tournament.LazerBracketPlayer[]
    >();
    expectTypeOf<Tournament.LazerBracketRound["Matches"]>().toEqualTypeOf<number[]>();
    expectTypeOf<typeof Tournament.buildLazerBracket>().toEqualTypeOf<
      (input: Tournament.BracketInput) => { bracket: Tournament.LazerBracket; json: string }
    >();
    expectTypeOf<Root.LazerBracket>().toEqualTypeOf<Tournament.LazerBracket>();
    expectTypeOf<Root.BracketTeam>().toEqualTypeOf<Tournament.BracketTeam>();
    expectTypeOf<Root.BracketRound>().toEqualTypeOf<Tournament.BracketRound>();
    expectTypeOf<Root.BracketMatch>().toEqualTypeOf<Tournament.BracketMatch>();
    expectTypeOf<Root.BracketSettings>().toEqualTypeOf<Tournament.BracketSettings>();
  });
});
