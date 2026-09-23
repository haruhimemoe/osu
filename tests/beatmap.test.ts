/**
 * @file tests/beatmap.test.ts
 * @desc osu!-v2 beatmap rows (from hinai or osu! itself) → BeatmapMeta.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Sep 22, 2026
 */

import { describe, expect, it } from "vitest";
import { osuBeatmapRowSchema, toBeatmapMeta } from "../src/index.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

const row = () => osuBeatmapRowSchema.parse(fixture.beatmaps[0]);

describe("toBeatmapMeta", () => {
  it("maps a row", () => {
    expect(toBeatmapMeta(row())).toEqual({
      beatmapId: 75,
      beatmapsetId: 1,
      mode: "osu",
      title: "DISCOPRINCE",
      artist: "Kenji Ninuma",
      version: "Normal",
      creator: "peppy",
      creatorId: 2,
      cs: 4,
      ar: 6,
      od: 6,
      hp: 6,
      bpm: 119.999,
      lengthSeconds: 142,
      starRating: 2.55,
      checksum: "a5b99395a42bd55bc5eb1d2411cbdf8b",
    });
  });

  it("drops a checksum that isn't an md5 and a missing creator id", () => {
    const meta = toBeatmapMeta({
      ...row(),
      checksum: "nope",
      beatmapset: { ...row().beatmapset, user_id: null },
    });
    expect(meta.checksum).toBeNull();
    expect(meta.creatorId).toBeNull();
  });

  it("rounds fractional lengths", () => {
    expect(toBeatmapMeta({ ...row(), total_length: 90.6 }).lengthSeconds).toBe(91);
  });
});
