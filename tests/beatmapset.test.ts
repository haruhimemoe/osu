/**
 * @file tests/beatmapset.test.ts
 * @desc Beatmapset parsing: an extended set from a recorded /beatmaps row, compact sets (missing
 *       availability, track_id or tags), nulls that still count as present, and stripped keys.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { describe, expect, it } from "vitest";
import { isExtendedBeatmapset, osuBeatmapsetRowSchema, osuBeatmapsetSchema } from "../src/index.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

const set = () => osuBeatmapsetRowSchema.parse(fixture.beatmaps[0]).beatmapset;

describe("beatmapsets", () => {
  it("reads the recorded row's set as extended", () => {
    const parsed = set();
    expect(parsed).toMatchObject({
      id: 1,
      status: "ranked",
      artist: "Kenji Ninuma",
      title: "DISCOPRINCE",
      tags: "katamari",
      track_id: null,
      availability: { download_disabled: false, more_information: null },
    });
    expect(isExtendedBeatmapset(parsed)).toBe(true);
  });

  it.each([
    ["availability", { availability: undefined }],
    ["track_id", { track_id: undefined }],
    ["tags", { tags: undefined }],
  ])("calls a set without %s compact", (_, missing) => {
    expect(isExtendedBeatmapset({ ...set(), ...missing })).toBe(false);
  });

  it("counts null tags and track id as present (osu! has none)", () => {
    expect(isExtendedBeatmapset({ ...set(), tags: null, track_id: null })).toBe(true);
  });

  it("rejects a row whose beatmap has no beatmapset", () => {
    expect(osuBeatmapsetRowSchema.safeParse({ id: 1, beatmapset_id: 1 }).success).toBe(false);
  });

  it("strips fields it doesn't use", () => {
    const parsed = osuBeatmapsetSchema.parse({ ...set(), covers: {}, bpm: 180 });
    expect(parsed).not.toHaveProperty("covers");
  });
});
