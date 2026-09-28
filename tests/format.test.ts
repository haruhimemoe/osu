/**
 * @file tests/format.test.ts
 * @desc /format: the display text packs and pools showed with their own copies, kept exactly:
 *       length m:ss, CS/AR/OD/HP to one decimal, BPM rounded, stars to two decimals, sizes in
 *       1024-based units, long durations and ranges. The first cases are packs' own tests.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { describe, expect, it } from "vitest";
import {
  formatBpm,
  formatBytes,
  formatDuration,
  formatLongDuration,
  formatRange,
  formatStars,
  formatStat,
} from "../src/format/index.js";

describe("beatmap numbers", () => {
  it.each([
    [0, "0:00"],
    [59, "0:59"],
    [258, "4:18"],
    [3600, "60:00"],
    [239.6, "4:00"],
    [59.5, "1:00"],
  ])("formatDuration(%d) = %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it("formatStat trims float noise to one decimal", () => {
    expect(formatStat(3.799999952316284)).toBe("3.8");
    expect(formatStat(9)).toBe("9");
    expect(formatStat(0)).toBe("0");
    expect(formatStat(8.25)).toBe("8.3");
  });

  it("formatBpm rounds", () => {
    expect(formatBpm(222.22000122070312)).toBe("222");
    expect(formatBpm(174.5)).toBe("175");
  });

  it("formatStars keeps two decimals", () => {
    expect(formatStars(7.805789947509766)).toBe("7.81");
    expect(formatStars(5)).toBe("5.00");
    expect(formatStars(0)).toBe("0.00");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [2048, "2.0 KB"],
    [10 * 1024, "10 KB"],
    [6_950_251, "6.6 MB"],
    [1_500_000_000, "1.4 GB"],
    [15 * 1024 ** 3, "15 GB"],
    [2 * 1024 ** 4, "2048 GB"],
  ])("%d bytes → %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("formatLongDuration", () => {
  it.each([
    [59, "0:59"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3725.4, "1:02:05"],
    [3599.5, "1:00:00"],
  ])("%d → %s", (seconds, text) => {
    expect(formatLongDuration(seconds)).toBe(text);
  });
});

describe("formatRange", () => {
  it("joins two ends with an en dash", () => {
    expect(formatRange(4.5, 6.2, formatStars)).toBe("4.50–6.20");
    expect(formatRange(95, 240, formatDuration)).toBe("1:35–4:00");
  });

  it("shows one value when both ends look the same", () => {
    expect(formatRange(5.3, 5.3, formatStars)).toBe("5.30");
    expect(formatRange(5.301, 5.299, formatStars)).toBe("5.30");
  });
});
