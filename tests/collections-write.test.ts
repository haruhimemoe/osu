/**
 * @file tests/collections-write.test.ts
 * @desc writeCollectionDb: byte-identical round trips of the vectors, the shortest ULEB128 length
 *       and UTF-8 byte counts, no cleanup of the data, the checks it makes (in order) and the
 *       size limit, plus random databases surviving a write and a read.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { describe, expect, it } from "vitest";
import {
  type CollectionDb,
  CollectionDbError,
  type OsuCollection,
  readCollectionDb,
  writeCollectionDb,
} from "../src/collections/index.js";
import {
  asciiHex,
  hex,
  MD5_A,
  MD5_ABC,
  MD5_DIGEST,
  MD5_EMPTY,
  TV1_EMPTY,
  TV2_FARM,
  TV3_UNICODE_AND_EMPTY,
  TV4_LONG_NAME,
  TV5_NULL_NAME,
  toHex,
} from "./collection-vectors.js";

const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

const writeError = (db: unknown, options?: { maxBytes?: number }) => {
  const error = thrown(() => writeCollectionDb(db as CollectionDb, options));
  expect(error).toBeInstanceOf(CollectionDbError);
  return error as CollectionDbError;
};

const one = (collection: OsuCollection, version = 20150203): CollectionDb => ({
  version,
  collections: [collection],
});

// The bytes a single-collection database writes after its 8-byte header.
const body = (db: CollectionDb) => toHex(writeCollectionDb(db).subarray(8));

describe("writeCollectionDb: round trips", () => {
  it.each([
    ["TV1", TV1_EMPTY],
    ["TV2", TV2_FARM],
    ["TV3", TV3_UNICODE_AND_EMPTY],
    ["TV4", TV4_LONG_NAME],
  ])("writes %s back byte for byte", (_name, vector) => {
    const bytes = hex(vector);
    expect(toHex(writeCollectionDb(readCollectionDb(bytes)))).toBe(toHex(bytes));
  });

  it("writes TV5's null name as an empty string", () => {
    expect(toHex(writeCollectionDb(readCollectionDb(hex(TV5_NULL_NAME))))).toBe(
      toHex(hex("bb 77 33 01 01 00 00 00 0b 00 00 00 00 00")),
    );
  });

  it("keeps the version it was given", () => {
    for (const version of [0, -1, 20150203, 20210520, 30000000, 2 ** 31 - 1, -(2 ** 31)]) {
      const bytes = writeCollectionDb({ version, collections: [] });
      expect(readCollectionDb(bytes).version).toBe(version);
    }
    expect(toHex(writeCollectionDb({ version: 30000000, collections: [] }))).toBe(
      "80 c3 c9 01 00 00 00 00",
    );
  });

  it("drops null hashes and trailing bytes a lenient read skipped", () => {
    const bytes = hex(
      `bb 77 33 01 01 00 00 00 0b 01 41 02 00 00 00 00 0b 20 ${asciiHex(MD5_A)} ff`,
    );
    const read = readCollectionDb(bytes, { lenient: true });
    expect(toHex(writeCollectionDb(read))).toBe(
      toHex(hex(`bb 77 33 01 01 00 00 00 0b 01 41 01 00 00 00 0b 20 ${asciiHex(MD5_A)}`)),
    );
  });
});

describe("writeCollectionDb: strings", () => {
  it("writes the shortest ULEB128 length", () => {
    const cases: [number, string][] = [
      [0, "0b 00"],
      [1, "0b 01"],
      [127, "0b 7f"],
      [128, "0b 80 01"],
      [200, "0b c8 01"],
      [16_383, "0b ff 7f"],
      [16_384, "0b 80 80 01"],
    ];
    for (const [length, prefix] of cases) {
      const written = body(one({ name: "x".repeat(length), hashes: [] }));
      expect(written.startsWith(prefix)).toBe(true);
      expect(written.length).toBe(prefix.length + length * 3 + 12); // " 78" per byte, then 4 zeros
    }
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(body(one({ name: "練習", hashes: [] }))).toBe("0b 06 e7 b7 b4 e7 bf 92 00 00 00 00");
    expect(body(one({ name: "é", hashes: [] }))).toBe("0b 02 c3 a9 00 00 00 00");
    expect(body(one({ name: "🎵", hashes: [] }))).toBe("0b 04 f0 9f 8e b5 00 00 00 00");
    expect(body(one({ name: "a練🎵é", hashes: [] }))).toBe(
      "0b 0a 61 e7 b7 b4 f0 9f 8e b5 c3 a9 00 00 00 00",
    );
  });

  it("keeps a leading byte order mark", () => {
    const bytes = writeCollectionDb(one({ name: "﻿A", hashes: [] }));
    expect(toHex(bytes.subarray(8))).toBe("0b 04 ef bb bf 41 00 00 00 00");
    expect(readCollectionDb(bytes).collections[0]?.name).toBe("﻿A");
  });

  it("writes hashes as given: no lowercasing, deduplicating or reordering", () => {
    const hashes = [MD5_A.toUpperCase(), MD5_EMPTY, MD5_EMPTY, "abc", ""];
    const db = one({ name: "A", hashes });
    expect(body(db)).toBe(
      toHex(
        hex(`
          0b 01 41  05 00 00 00
          0b 20 ${asciiHex(MD5_A.toUpperCase())}
          0b 20 ${asciiHex(MD5_EMPTY)}
          0b 20 ${asciiHex(MD5_EMPTY)}
          0b 03 61 62 63
          0b 00
        `),
      ),
    );
    expect(readCollectionDb(writeCollectionDb(db)).collections[0]?.hashes).toEqual(hashes);
  });

  it("returns a plain Uint8Array over its own ArrayBuffer", () => {
    const bytes = writeCollectionDb(readCollectionDb(hex(TV2_FARM)));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
  });
});

describe("writeCollectionDb: checks", () => {
  it("rejects a version that isn't an int32", () => {
    for (const version of [2 ** 31, -(2 ** 31) - 1, 1.5, Number.NaN, "20150203", undefined]) {
      expect(writeError({ version, collections: [] })).toMatchObject({
        code: "invalid_version",
        offset: null,
        collection: null,
        hash: null,
      });
    }
  });

  it("rejects a name that isn't a string or holds a lone surrogate", () => {
    for (const name of [null, 1, undefined, "\uD800", "a\uDC00b", "\uDFB5\uD83C"]) {
      const db = {
        version: 1,
        collections: [
          { name: "ok", hashes: [] },
          { name, hashes: [] },
        ],
      };
      expect(writeError(db)).toMatchObject({ code: "invalid_name", collection: 1, hash: null });
    }
  });

  it("rejects a hash that isn't a string or holds a lone surrogate", () => {
    for (const hash of [null, 1, undefined, "\uD83C"]) {
      const db = {
        version: 1,
        collections: [
          { name: "A", hashes: [] },
          { name: "B", hashes: [MD5_A, hash] },
        ],
      };
      expect(writeError(db)).toMatchObject({ code: "invalid_hash", collection: 1, hash: 1 });
    }
  });

  it("checks the version, then every name, then every hash, then the size", () => {
    const badHashFirst = {
      version: 1,
      collections: [
        { name: "A", hashes: [null] },
        { name: null, hashes: [] },
      ],
    };
    expect(writeError(badHashFirst).code).toBe("invalid_name");
    expect(writeError({ ...badHashFirst, version: 0.5 }).code).toBe("invalid_version");
    const bigAndBad = one({ name: "A", hashes: [MD5_A, 7 as unknown as string] });
    expect(writeError(bigAndBad, { maxBytes: 8 }).code).toBe("invalid_hash");
  });

  it("keeps names and hashes out of error messages", () => {
    const error = writeError(one({ name: "Secret\uD800", hashes: [] }));
    expect(error.message).not.toContain("Secret");
  });

  it("throws a TypeError for a database that isn't shaped like one", () => {
    for (const db of [
      null,
      "db",
      { version: 1 },
      { version: 1, collections: "A" },
      { version: 1, collections: [null] },
      { version: 1, collections: [{ name: "A" }] },
      { version: 1, collections: [{ name: "A", hashes: MD5_A }] },
    ]) {
      expect(() => writeCollectionDb(db as unknown as CollectionDb)).toThrow(TypeError);
    }
  });
});

describe("writeCollectionDb: size", () => {
  it("rejects output over maxBytes", () => {
    const db = readCollectionDb(hex(TV2_FARM));
    expect(writeCollectionDb(db, { maxBytes: 86 }).byteLength).toBe(86);
    expect(writeError(db, { maxBytes: 85 })).toMatchObject({ code: "too_large", offset: null });
  });

  it("defaults maxBytes to 64 MiB", () => {
    // 2,000,000 hashes of 34 bytes is just over 64 MiB.
    const db = one({ name: "x", hashes: new Array<string>(2_000_000).fill(MD5_A) });
    expect(writeError(db).code).toBe("too_large");
  });

  it("throws a RangeError for a maxBytes that isn't a positive safe integer", () => {
    const db = readCollectionDb(hex(TV1_EMPTY));
    for (const maxBytes of [0, -1, 1.5, Number.NaN, 2 ** 53, "86"]) {
      expect(() => writeCollectionDb(db, { maxBytes: maxBytes as number })).toThrow(RangeError);
    }
  });
});

describe("writeCollectionDb and readCollectionDb together", () => {
  // mulberry32: a small seeded generator, so a failure can be replayed.
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const PIECES = ["a", "Z", " ", "0", "é", "練", "習", "🎵", "﻿", "\u0000", "-", "!"];
  const HASHES = [MD5_EMPTY, MD5_A, MD5_ABC, MD5_DIGEST, MD5_A.toUpperCase(), "abc", ""];

  it("reads back what it wrote, for 300 random databases", () => {
    const next = random(20260924);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    for (let round = 0; round < 300; round++) {
      const collections = Array.from({ length: Math.floor(next() * 6) }, () => ({
        // Up to 70 pieces, so some names pass 127 bytes and need a two-byte length.
        name: Array.from({ length: Math.floor(next() * 70) }, () => pick(PIECES)).join(""),
        hashes: Array.from({ length: Math.floor(next() * 5) }, () => pick(HASHES)),
      }));
      const db = { version: Math.floor(next() * 2 ** 32) - 2 ** 31, collections };
      const bytes = writeCollectionDb(db);
      const read = readCollectionDb(bytes);
      expect({ version: read.version, collections: read.collections }).toEqual(db);
      expect(toHex(writeCollectionDb(read))).toBe(toHex(bytes));
    }
  });

  it("round-trips 100,000 hashes", () => {
    const hashes = Array.from({ length: 100_000 }, (_, i) => i.toString(16).padStart(32, "0"));
    const bytes = writeCollectionDb(one({ name: "big", hashes }));
    expect(bytes.byteLength).toBe(8 + 5 + 4 + 100_000 * 34);
    expect(readCollectionDb(bytes).collections[0]?.hashes).toEqual(hashes);
  });
});
