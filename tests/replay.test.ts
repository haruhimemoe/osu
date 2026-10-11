/**
 * @file tests/replay.test.ts
 * @desc The .osr header reader (0.9): every field of a built replay, old replays without a score
 *       id, mods from bits, files that end early or aren't replays, and replayScore's statistics,
 *       accuracy and rank per ruleset.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sat Oct 10, 2026
 * @modified Sat Oct 10, 2026
 */

import { describe, expect, it } from "vitest";
import {
  modsFromFlags,
  parseReplayHeader,
  ReplayError,
  type ReplayHeader,
  replayScore,
} from "../src/replay/index.js";

const MD5 = "a5b99395a42bd55bc5eb1d2411cbdf8b";

/** An .osr with the given fields; `scoreId: null` leaves the trailing id out (old replays). */
const osr = (
  over: {
    mode?: number;
    md5?: string;
    name?: string;
    counts?: number[];
    mods?: number;
    ticks?: bigint;
    data?: number;
    scoreId?: bigint | null;
  } = {},
): Uint8Array => {
  const out: number[] = [];
  const int = (value: number) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, value, true);
    out.push(...new Uint8Array(b.buffer));
  };
  const short = (value: number) => out.push(value & 0xff, value >> 8);
  const long = (value: bigint) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setBigInt64(0, value, true);
    out.push(...new Uint8Array(b.buffer));
  };
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    out.push(0x0b);
    let n = bytes.length;
    do {
      let part = n & 0x7f;
      n >>= 7;
      if (n) part |= 0x80;
      out.push(part);
    } while (n);
    out.push(...bytes);
  };
  out.push(over.mode ?? 0);
  int(20260101);
  text(over.md5 ?? MD5);
  text(over.name ?? "peppy");
  text("ffffffffffffffffffffffffffffffff");
  for (const count of over.counts ?? [300, 4, 1, 50, 2, 1]) short(count);
  int(912345);
  short(314);
  out.push(0);
  int(over.mods ?? 8 + 64 + 512);
  text("");
  long(over.ticks ?? 639_000_000_000_000_000n);
  const data = over.data ?? 3;
  int(data);
  out.push(...new Array(data).fill(7));
  if (over.scoreId !== null) long(over.scoreId ?? 4_000_000_001n);
  return new Uint8Array(out);
};

describe("parseReplayHeader", () => {
  it("reads every field", () => {
    const header = parseReplayHeader(osr());
    expect(header).toEqual({
      ruleset: "osu",
      version: 20260101,
      beatmapMd5: MD5,
      username: "peppy",
      counts: { n300: 300, n100: 4, n50: 1, geki: 50, katu: 2, miss: 1 },
      totalScore: 912345,
      maxCombo: 314,
      perfect: false,
      modFlags: 8 + 64 + 512,
      mods: ["HD", "NC"],
      playedAt: new Date(
        Number((639_000_000_000_000_000n - 621_355_968_000_000_000n) / 10_000n),
      ).toISOString(),
      scoreId: 4_000_000_001,
    });
  });

  it("reads a long name, an old replay without a score id, and a zero id", () => {
    expect(parseReplayHeader(osr({ name: "x".repeat(200) })).username).toHaveLength(200);
    expect(parseReplayHeader(osr({ scoreId: null })).scoreId).toBeNull();
    expect(parseReplayHeader(osr({ scoreId: 0n })).scoreId).toBeNull();
  });

  it("refuses what isn't a replay", () => {
    expect(() => parseReplayHeader(new Uint8Array())).toThrow(ReplayError);
    expect(() => parseReplayHeader(osr({ mode: 9 }))).toThrow(ReplayError);
    expect(() => parseReplayHeader(osr({ md5: "nope" }))).toThrow(ReplayError);
    expect(() => parseReplayHeader(osr().subarray(0, 60))).toThrow(/ends before/);
    expect(() => parseReplayHeader(osr({ data: 3 }).subarray(0, -11))).toThrow(ReplayError);
  });
});

describe("modsFromFlags", () => {
  it("names bits, dropping DT under NC and SD under PF", () => {
    expect(modsFromFlags(0)).toEqual([]);
    expect(modsFromFlags(16 + 32 + 16384)).toEqual(["HR", "PF"]);
    expect(modsFromFlags(1 << 29)).toEqual(["V2"]);
  });
});

describe("replayScore", () => {
  const header = (over: Partial<ReplayHeader>): ReplayHeader => ({
    ...parseReplayHeader(osr()),
    ...over,
  });

  it("scores osu! by stable's rules", () => {
    const counts = { n300: 300, n100: 4, n50: 1, geki: 0, katu: 0, miss: 1 };
    const score = replayScore(header({ counts, mods: [] }));
    expect(score.statistics).toEqual({ great: 300, ok: 4, meh: 1, miss: 1 });
    expect(score.accuracy).toBeCloseTo((90000 + 400 + 50) / (300 * 306));
    expect(score.rank).toBe("A");
    const ss = replayScore(
      header({ counts: { ...counts, n100: 0, n50: 0, miss: 0 }, mods: ["HD"] }),
    );
    expect(ss).toMatchObject({ accuracy: 1, rank: "XH" });
  });

  it("scores taiko, catch and mania", () => {
    const counts = { n300: 90, n100: 10, n50: 0, geki: 0, katu: 0, miss: 0 };
    expect(replayScore(header({ ruleset: "taiko", counts, mods: [] }))).toMatchObject({
      statistics: { great: 90, ok: 10, miss: 0 },
      accuracy: 0.95,
      rank: "A",
    });
    expect(
      replayScore(header({ ruleset: "fruits", counts: { ...counts, katu: 1 }, mods: ["HD"] })),
    ).toMatchObject({ statistics: { small_tick_miss: 1 }, rank: "SH" });
    const mania = replayScore(
      header({ ruleset: "mania", counts: { ...counts, geki: 100, katu: 0 }, mods: [] }),
    );
    expect(mania.statistics).toEqual({ perfect: 100, great: 90, good: 0, ok: 10, meh: 0, miss: 0 });
    expect(mania.rank).toBe("S");
  });
});
