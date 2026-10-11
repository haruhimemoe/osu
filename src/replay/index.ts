/**
 * @file src/replay/index.ts
 * @desc @haruhimemoe/osu/replay: the header of an .osr replay (stable or lazer export): ruleset,
 *       beatmap MD5, player, hit counts, score, combo, mods and when it was set, without the
 *       LZMA cursor data. replayScore turns the counts into lazer statistics with stable's
 *       accuracy and rank, so a replay can be shown like an API score. Imports nothing.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sat Oct 10, 2026
 * @modified Sat Oct 10, 2026
 */

/** What parseReplayHeader reads from an .osr. */
export type ReplayHeader = {
  ruleset: "osu" | "taiko" | "fruits" | "mania";
  /** The game version that saved it (yyyymmdd for stable). */
  version: number;
  /** The difficulty's MD5, lowercase. */
  beatmapMd5: string;
  username: string;
  counts: {
    n300: number;
    n100: number;
    n50: number;
    geki: number;
    katu: number;
    miss: number;
  };
  totalScore: number;
  maxCombo: number;
  perfect: boolean;
  /** The stable mod bit flags. */
  modFlags: number;
  /** The same as acronyms (NC without DT, PF without SD). */
  mods: string[];
  /** When it was set, as an ISO string. */
  playedAt: string;
  /** The online score id, or null when it wasn't submitted. */
  scoreId: number | null;
};

/** Why an .osr couldn't be read. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

const RULESETS = ["osu", "taiko", "fruits", "mania"] as const;

/** Stable's mod bits in bit order. */
const MOD_BITS: readonly (readonly [number, string])[] = [
  [0, "NF"],
  [1, "EZ"],
  [2, "TD"],
  [3, "HD"],
  [4, "HR"],
  [5, "SD"],
  [6, "DT"],
  [7, "RX"],
  [8, "HT"],
  [9, "NC"],
  [10, "FL"],
  [11, "AT"],
  [12, "SO"],
  [13, "AP"],
  [14, "PF"],
  [15, "4K"],
  [16, "5K"],
  [17, "6K"],
  [18, "7K"],
  [19, "8K"],
  [20, "FI"],
  [21, "RD"],
  [22, "CN"],
  [23, "TP"],
  [24, "9K"],
  [25, "CO"],
  [26, "1K"],
  [27, "3K"],
  [28, "2K"],
  [29, "V2"],
  [30, "MR"],
];

/** .NET ticks (100 ns since 0001-01-01) at the Unix epoch. */
const EPOCH_TICKS = 621_355_968_000_000_000n;

/**
 * @function modsFromFlags
 * @param flags {number} stable's mod bits
 * @returns {string[]} acronyms in bit order, NC without its DT and PF without its SD
 */
export const modsFromFlags = (flags: number): string[] => {
  const mods = MOD_BITS.filter(([bit]) => ((flags >>> 0) & (1 << bit) ? true : false)).map(
    ([, acronym]) => acronym,
  );
  return mods.filter(
    (mod) => !(mod === "DT" && mods.includes("NC")) && !(mod === "SD" && mods.includes("PF")),
  );
};

/**
 * @function parseReplayHeader
 * @param bytes {Uint8Array} an .osr file
 * @returns {ReplayHeader} its header
 * @throws {ReplayError} when it ends early or isn't an .osr
 */
export const parseReplayHeader = (bytes: Uint8Array): ReplayHeader => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (count: number, field: string) => {
    if (at + count > bytes.length) throw new ReplayError(`The replay ends before its ${field}.`);
  };
  const byte = (field: string) => {
    need(1, field);
    return bytes[at++] as number;
  };
  const short = (field: string) => {
    need(2, field);
    const value = view.getUint16(at, true);
    at += 2;
    return value;
  };
  const int = (field: string) => {
    need(4, field);
    const value = view.getInt32(at, true);
    at += 4;
    return value;
  };
  const long = (field: string) => {
    need(8, field);
    const value = view.getBigInt64(at, true);
    at += 8;
    return value;
  };
  const text = (field: string): string => {
    const marker = byte(field);
    if (marker === 0x00) return "";
    if (marker !== 0x0b) throw new ReplayError(`The replay's ${field} isn't a string.`);
    let length = 0;
    let shift = 0;
    for (;;) {
      const part = byte(field);
      length |= (part & 0x7f) << shift;
      if (!(part & 0x80)) break;
      shift += 7;
      if (shift > 28) throw new ReplayError(`The replay's ${field} is too long.`);
    }
    need(length, field);
    const value = new TextDecoder().decode(bytes.subarray(at, at + length));
    at += length;
    return value;
  };

  const mode = byte("mode");
  const ruleset = RULESETS[mode];
  if (!ruleset) throw new ReplayError("That isn't an osu! replay.");
  const version = int("version");
  const beatmapMd5 = text("beatmap hash").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(beatmapMd5)) throw new ReplayError("That isn't an osu! replay.");
  const username = text("player name");
  text("replay hash");
  const counts = {
    n300: short("300s"),
    n100: short("100s"),
    n50: short("50s"),
    geki: short("gekis"),
    katu: short("katus"),
    miss: short("misses"),
  };
  const totalScore = int("score");
  const maxCombo = short("combo");
  const perfect = byte("perfect flag") === 1;
  const modFlags = int("mods") >>> 0;
  text("life bar");
  const ticks = long("timestamp");
  const dataLength = int("replay data length");
  if (dataLength < 0) throw new ReplayError("The replay's data length is negative.");
  need(dataLength, "replay data");
  at += dataLength;
  // Very old replays end here; the score id came later (version 20140721 on).
  let scoreId: number | null = null;
  if (at + 8 <= bytes.length) {
    const id = Number(long("score id"));
    scoreId = id > 0 && Number.isSafeInteger(id) ? id : null;
  }
  const ms = Number((ticks - EPOCH_TICKS) / 10_000n);
  return {
    ruleset,
    version,
    beatmapMd5,
    username,
    counts,
    totalScore,
    maxCombo,
    perfect,
    modFlags,
    mods: modsFromFlags(modFlags),
    playedAt:
      Number.isFinite(ms) && Math.abs(ms) < 8.64e15
        ? new Date(ms).toISOString()
        : new Date(0).toISOString(),
    scoreId,
  };
};

/** A replay as a lazer score's numbers. */
export type ReplayScore = {
  /** Lazer's statistic names, e.g. great/ok/meh/miss in osu!. */
  statistics: Record<string, number>;
  /** 0 to 1, by stable's formula for the ruleset. */
  accuracy: number;
  /** Stable's rank, XH/SH with HD or FL. */
  rank: "XH" | "X" | "SH" | "S" | "A" | "B" | "C" | "D";
};

/**
 * @function replayScore
 * @param header {ReplayHeader} a parsed replay
 * @returns {ReplayScore} its statistics, accuracy and rank
 */
export const replayScore = (header: ReplayHeader): ReplayScore => {
  const { n300, n100, n50, geki, katu, miss } = header.counts;
  const hidden =
    header.mods.includes("HD") || header.mods.includes("FL") || header.mods.includes("FI");
  let statistics: Record<string, number>;
  let accuracy: number;
  let rank: ReplayScore["rank"];
  const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
  /** osu! and taiko: by the share of 300s, the 50s and misses. */
  const byShare = (total: number, fifties: number): ReplayScore["rank"] => {
    const great = ratio(n300, total);
    if (great === 1) return "X";
    if (great > 0.9 && ratio(fifties, total) <= 0.01 && miss === 0) return "S";
    if ((great > 0.8 && miss === 0) || great > 0.9) return "A";
    if ((great > 0.7 && miss === 0) || great > 0.8) return "B";
    if (great > 0.6) return "C";
    return "D";
  };
  /** catch and mania: by accuracy. */
  const byAccuracy = (steps: readonly [number, ReplayScore["rank"]][]): ReplayScore["rank"] => {
    if (accuracy === 1) return "X";
    return steps.find(([floor]) => accuracy > floor)?.[1] ?? "D";
  };
  switch (header.ruleset) {
    case "osu": {
      const total = n300 + n100 + n50 + miss;
      statistics = { great: n300, ok: n100, meh: n50, miss };
      accuracy = ratio(300 * n300 + 100 * n100 + 50 * n50, 300 * total);
      rank = byShare(total, n50);
      break;
    }
    case "taiko": {
      const total = n300 + n100 + miss;
      statistics = { great: n300, ok: n100, miss };
      accuracy = ratio(n300 + 0.5 * n100, total);
      rank = byShare(total, 0);
      break;
    }
    case "fruits": {
      statistics = {
        great: n300,
        large_tick_hit: n100,
        small_tick_hit: n50,
        small_tick_miss: katu,
        miss,
      };
      accuracy = ratio(n300 + n100 + n50, n300 + n100 + n50 + katu + miss);
      rank = byAccuracy([
        [0.98, "S"],
        [0.94, "A"],
        [0.9, "B"],
        [0.85, "C"],
      ]);
      break;
    }
    case "mania": {
      const total = geki + n300 + katu + n100 + n50 + miss;
      statistics = { perfect: geki, great: n300, good: katu, ok: n100, meh: n50, miss };
      accuracy = ratio(300 * (geki + n300) + 200 * katu + 100 * n100 + 50 * n50, 300 * total);
      rank = byAccuracy([
        [0.95, "S"],
        [0.9, "A"],
        [0.8, "B"],
        [0.7, "C"],
      ]);
      break;
    }
  }
  if (hidden && rank === "X") rank = "XH";
  if (hidden && rank === "S") rank = "SH";
  return { statistics, accuracy, rank };
};
