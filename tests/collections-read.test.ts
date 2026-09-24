/**
 * @file tests/collections-read.test.ts
 * @desc readCollectionDb against hand-built vectors: the stable layout, osu! strings (ULEB128
 *       byte lengths, the null marker, non-ASCII UTF-8, a leading BOM), warnings for oddities it
 *       keeps (indexed into hashes, the first 1,000 listed), a CollectionDbError with a code and
 *       byte offset for truncated or garbage input, and the maxBytes / 34 entry cap that stops
 *       64 MiB of one- or two-byte entries before they're built.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { describe, expect, it } from "vitest";
import {
  CollectionDbError,
  MAX_COLLECTION_DB_BYTES,
  readCollectionDb,
} from "../src/collections/index.js";
import {
  asciiHex,
  hex,
  MD5_A,
  MD5_EMPTY,
  TV1_EMPTY,
  TV2_FARM,
  TV3_UNICODE_AND_EMPTY,
  TV4_LONG_NAME,
  TV5_NULL_NAME,
  TV6_BAD_MARKER,
  TV7_SHORT,
  toHex,
} from "./collection-vectors.js";

const HEADER_ONE = "bb 77 33 01  01 00 00 00"; // version 20150203, 1 collection
const HEADER_TWO = "bb 77 33 01  02 00 00 00"; // version 20150203, 2 collections

// A little-endian int32 as spaced hex, for counts.
const int32 = (value: number): string => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return toHex(bytes);
};
const compactHex = (bytes: Uint8Array): string => toHex(bytes).replaceAll(" ", "");

// The thrown value, so its fields can be matched.
const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

const readError = (bytes: Uint8Array, options?: { lenient?: boolean; maxBytes?: number }) => {
  const error = thrown(() => readCollectionDb(bytes, options));
  expect(error).toBeInstanceOf(CollectionDbError);
  return error as CollectionDbError;
};

describe("readCollectionDb: the vectors", () => {
  it("reads TV1, an empty database", () => {
    expect(readCollectionDb(hex(TV1_EMPTY))).toEqual({
      version: 20150203,
      collections: [],
      warnings: [],
      omittedWarnings: 0,
    });
  });

  it("reads TV2, one collection with two hashes", () => {
    const bytes = hex(TV2_FARM);
    expect(bytes.byteLength).toBe(86);
    expect(readCollectionDb(bytes)).toEqual({
      version: 20210520,
      collections: [{ name: "Farm", hashes: [MD5_EMPTY, MD5_A] }],
      warnings: [],
      omittedWarnings: 0,
    });
  });

  it("reads TV3: a name's length counts UTF-8 bytes, and an empty name is kept with a warning", () => {
    const bytes = hex(TV3_UNICODE_AND_EMPTY);
    expect(bytes.byteLength).toBe(60);
    expect(readCollectionDb(bytes)).toEqual({
      version: 20150203,
      collections: [
        { name: "練習", hashes: [MD5_A] },
        { name: "", hashes: [] },
      ],
      warnings: [{ code: "empty_name", offset: 54, collection: 1, hash: null }],
      omittedWarnings: 0,
    });
  });

  it("reads TV4, a name whose length takes two ULEB128 bytes", () => {
    const bytes = hex(TV4_LONG_NAME);
    expect(bytes.byteLength).toBe(215);
    const read = readCollectionDb(bytes);
    expect(read.collections).toEqual([{ name: "a".repeat(200), hashes: [] }]);
    expect(read.warnings).toEqual([]);
  });

  it("reads TV5's null name as an empty name with a warning", () => {
    expect(readCollectionDb(hex(TV5_NULL_NAME))).toEqual({
      version: 20150203,
      collections: [{ name: "", hashes: [] }],
      warnings: [{ code: "null_name", offset: 8, collection: 0, hash: null }],
      omittedWarnings: 0,
    });
  });

  it("rejects TV6's unknown marker, or reads it as a string when lenient", () => {
    expect(readError(hex(TV6_BAD_MARKER))).toMatchObject({
      code: "bad_marker",
      offset: 8,
      collection: 0,
      hash: null,
    });
    expect(readCollectionDb(hex(TV6_BAD_MARKER), { lenient: true })).toEqual({
      version: 20150203,
      collections: [{ name: "hi", hashes: [] }],
      warnings: [{ code: "unknown_marker", offset: 8, collection: 0, hash: null }],
      omittedWarnings: 0,
    });
  });

  it("rejects TV7's count: 2 collections can't fit in the 7 bytes left", () => {
    // Every collection takes at least 5 bytes (marker and hash count). Counts are checked before
    // the records are read, so a file cut off soon after a count is a bad_count, not truncated.
    expect(readError(hex(TV7_SHORT))).toMatchObject({
      code: "bad_count",
      offset: 4,
      collection: null,
      hash: null,
    });
  });
});

describe("readCollectionDb: osu! strings", () => {
  it("keeps a leading byte order mark in a name", () => {
    const read = readCollectionDb(hex(`${HEADER_ONE} 0b 06 ef bb bf 41 42 43 00 00 00 00`));
    expect(read.collections[0]?.name).toBe("﻿ABC");
  });

  it("reads 2-, 3- and 4-byte UTF-8 characters", () => {
    // "é🎵" is 2 + 4 bytes.
    const read = readCollectionDb(hex(`${HEADER_ONE} 0b 06 c3 a9 f0 9f 8e b5 00 00 00 00`));
    expect(read.collections[0]?.name).toBe("é🎵");
  });

  it("accepts a length written with more ULEB128 bytes than it needs", () => {
    // 04 written as 84 00, which .NET also reads.
    const read = readCollectionDb(hex(`${HEADER_ONE} 0b 84 00 46 61 72 6d 00 00 00 00`));
    expect(read.collections[0]?.name).toBe("Farm");
  });

  it("reads a length of three ULEB128 bytes", () => {
    const name = "b".repeat(16_384); // 80 80 01
    const bytes = hex(`${HEADER_ONE} 0b 80 80 01 ${"62 ".repeat(16_384)} 00 00 00 00`);
    expect(readCollectionDb(bytes).collections[0]?.name).toBe(name);
  });

  it("rejects a length of more than 5 ULEB128 bytes", () => {
    const bytes = hex(`${HEADER_ONE} 0b 80 80 80 80 80 00 00 00 00 00`);
    expect(readError(bytes)).toMatchObject({ code: "bad_length", offset: 9, collection: 0 });
  });

  it("rejects a length over int32 max", () => {
    for (const length of ["80 80 80 80 08", "ff ff ff ff 0f", "ff ff ff ff 7f"]) {
      const bytes = hex(`${HEADER_ONE} 0b ${length} 00 00 00 00`);
      expect(readError(bytes)).toMatchObject({ code: "bad_length", offset: 9 });
    }
  });

  it("rejects a length that runs past the end", () => {
    // int32 max itself is a valid length, but not in 4 bytes.
    const max = hex(`${HEADER_ONE} 0b ff ff ff ff 07 00 00 00 00`);
    expect(readError(max)).toMatchObject({ code: "bad_length", offset: 9, collection: 0 });
    const short = hex(`${HEADER_ONE} 0b 05 46 61 72 6d`);
    expect(readError(short)).toMatchObject({ code: "bad_length", offset: 9 });
  });

  it("rejects invalid UTF-8, or replaces it with a warning when lenient", () => {
    const bytes = hex(`${HEADER_ONE} 0b 02 ff 41 00 00 00 00`);
    expect(readError(bytes)).toMatchObject({
      code: "invalid_utf8",
      offset: 10,
      collection: 0,
      hash: null,
    });
    expect(readCollectionDb(bytes, { lenient: true })).toMatchObject({
      collections: [{ name: "�A", hashes: [] }],
      warnings: [{ code: "invalid_utf8", offset: 10, collection: 0, hash: null }],
    });
  });

  it("checks hashes the same way as names", () => {
    const badUtf8 = hex(`${HEADER_ONE} 0b 01 41 01 00 00 00 0b 01 c0`);
    expect(readError(badUtf8)).toMatchObject({
      code: "invalid_utf8",
      offset: 17,
      collection: 0,
      hash: 0,
    });
    const badMarker = hex(`${HEADER_ONE} 0b 01 41 01 00 00 00 0c 20 ${asciiHex(MD5_A)}`);
    expect(readError(badMarker)).toMatchObject({ code: "bad_marker", offset: 15, hash: 0 });
    expect(readCollectionDb(badMarker, { lenient: true })).toMatchObject({
      collections: [{ name: "A", hashes: [MD5_A] }],
      warnings: [{ code: "unknown_marker", offset: 15, collection: 0, hash: 0 }],
    });
    const pastEnd = hex(`${HEADER_ONE} 0b 01 41 01 00 00 00 0b 20 ${asciiHex(MD5_A.slice(0, 20))}`);
    expect(readError(pastEnd)).toMatchObject({ code: "bad_length", offset: 16, hash: 0 });
  });
});

describe("readCollectionDb: warnings", () => {
  // Two collections named "A". The first holds MD5_A twice, MD5_EMPTY in uppercase, the malformed
  // "abc" and a null hash; the second is empty.
  const oddities = hex(`
    ${HEADER_TWO}
    0b 01 41  05 00 00 00
    0b 20 ${asciiHex(MD5_A)}
    0b 20 ${asciiHex(MD5_A)}
    0b 20 ${asciiHex(MD5_EMPTY.toUpperCase())}
    0b 03 61 62 63
    00
    0b 01 41  00 00 00 00
  `);

  it("keeps oddities as found and reports each one, in file order", () => {
    expect(oddities.byteLength).toBe(130);
    expect(readCollectionDb(oddities)).toEqual({
      version: 20150203,
      collections: [
        { name: "A", hashes: [MD5_A, MD5_A, MD5_EMPTY.toUpperCase(), "abc"] },
        { name: "A", hashes: [] },
      ],
      warnings: [
        { code: "duplicate_hash", offset: 49, collection: 0, hash: 1 },
        { code: "uppercase_hash", offset: 83, collection: 0, hash: 2 },
        { code: "malformed_hash", offset: 117, collection: 0, hash: 3 },
        { code: "null_hash", offset: 122, collection: 0, hash: null },
        { code: "duplicate_name", offset: 123, collection: 1, hash: null },
      ],
      omittedWarnings: 0,
    });
  });

  it("points a warning's hash at its index in hashes, and a dropped null hash at nothing", () => {
    const upper = MD5_EMPTY.toUpperCase();
    const bytes = hex(
      `${HEADER_ONE} 0b 01 41 03 00 00 00 00 0b 20 ${asciiHex(upper)} 0b 03 61 62 63`,
    );
    const read = readCollectionDb(bytes);
    expect(read).toMatchObject({
      collections: [{ name: "A", hashes: [upper, "abc"] }],
      warnings: [
        { code: "null_hash", offset: 15, collection: 0, hash: null },
        { code: "uppercase_hash", offset: 16, collection: 0, hash: 0 },
        { code: "malformed_hash", offset: 50, collection: 0, hash: 1 },
      ],
    });
    // What a UI does with a warning: highlight collections[collection].hashes[hash].
    const [, uppercase, malformed] = read.warnings;
    expect(read.collections[0]?.hashes[uppercase?.hash ?? -1]).toBe(upper);
    expect(read.collections[0]?.hashes[malformed?.hash ?? -1]).toBe("abc");
  });

  it("indexes lenient warnings on hashes the same way", () => {
    const bytes = hex(`${HEADER_ONE} 0b 01 41 03 00 00 00 00 0c 20 ${asciiHex(MD5_A)} 0b 02 ff 41`);
    expect(readCollectionDb(bytes, { lenient: true })).toMatchObject({
      collections: [{ name: "A", hashes: [MD5_A, "\ufffdA"] }],
      warnings: [
        { code: "null_hash", offset: 15, collection: 0, hash: null },
        { code: "unknown_marker", offset: 16, collection: 0, hash: 0 },
        { code: "invalid_utf8", offset: 52, collection: 0, hash: 1 },
        { code: "malformed_hash", offset: 50, collection: 0, hash: 1 },
      ],
    });
  });

  it("lists the first 1,000 warnings and counts the rest in omittedWarnings", () => {
    const nulls = (count: number) =>
      hex(`${HEADER_ONE} 0b 01 41 ${int32(count)} ${"00 ".repeat(count)}`);
    const exact = readCollectionDb(nulls(1000));
    expect(exact.warnings).toHaveLength(1000);
    expect(exact.omittedWarnings).toBe(0);
    const over = readCollectionDb(nulls(1003));
    expect(over.warnings).toHaveLength(1000);
    expect(over.warnings.at(-1)).toMatchObject({ code: "null_hash", offset: 1014 });
    expect(over.omittedWarnings).toBe(3);
  });

  it("warns about a duplicated uppercase hash twice over", () => {
    const upper = MD5_A.toUpperCase();
    const bytes = hex(
      `${HEADER_ONE} 0b 01 41 02 00 00 00 0b 20 ${asciiHex(upper)} 0b 20 ${asciiHex(upper)}`,
    );
    expect(readCollectionDb(bytes).warnings.map((warning) => warning.code)).toEqual([
      "uppercase_hash",
      "uppercase_hash",
      "duplicate_hash",
    ]);
  });

  it("warns about a second null name as a duplicate too", () => {
    const bytes = hex(`${HEADER_TWO} 00 00 00 00 00  00 00 00 00 00`);
    expect(readCollectionDb(bytes).warnings).toEqual([
      { code: "null_name", offset: 8, collection: 0, hash: null },
      { code: "null_name", offset: 13, collection: 1, hash: null },
      { code: "duplicate_name", offset: 13, collection: 1, hash: null },
    ]);
  });

  it("rejects trailing bytes, or warns about them when lenient", () => {
    const bytes = hex(`${TV1_EMPTY} 00 01`);
    expect(readError(bytes)).toMatchObject({ code: "trailing_bytes", offset: 8 });
    expect(readCollectionDb(bytes, { lenient: true })).toEqual({
      version: 20150203,
      collections: [],
      warnings: [{ code: "trailing_bytes", offset: 8, collection: null, hash: null }],
      omittedWarnings: 0,
    });
  });
});

describe("readCollectionDb: truncated and garbage input", () => {
  it("rejects anything under 8 bytes as truncated", () => {
    expect(readError(new Uint8Array(0))).toMatchObject({ code: "truncated", offset: 0 });
    expect(readError(hex("bb 77 33"))).toMatchObject({ code: "truncated", offset: 0 });
    expect(readError(hex("bb 77 33 01 00 00 00"))).toMatchObject({
      code: "truncated",
      offset: 4,
    });
  });

  it("rejects a file that ends at a collection's marker", () => {
    const bytes = hex(`${HEADER_TWO} 0b 01 41 01 00 00 00 0b 20 ${asciiHex(MD5_A)}`);
    expect(readError(bytes)).toMatchObject({ code: "truncated", offset: 49, collection: 1 });
  });

  it("rejects a file that ends in a hash count", () => {
    const bytes = hex(`${HEADER_TWO} 0b 01 41 00 00 00 00 0b 01 42`);
    expect(readError(bytes)).toMatchObject({
      code: "truncated",
      offset: 18,
      collection: 1,
      hash: null,
    });
  });

  it("rejects a file that ends partway through a length", () => {
    const bytes = hex(`${HEADER_ONE} 0b 01 41 01 00 00 00 0b a0`);
    expect(readError(bytes)).toMatchObject({
      code: "truncated",
      offset: 16,
      collection: 0,
      hash: 0,
    });
  });

  it("rejects a file that ends before its last hash", () => {
    const bytes = hex(TV2_FARM).subarray(0, 52);
    expect(readError(bytes)).toMatchObject({
      code: "truncated",
      offset: 52,
      collection: 0,
      hash: 1,
    });
  });

  it("rejects a negative collection count", () => {
    expect(readError(hex("bb 77 33 01 ff ff ff ff"))).toMatchObject({
      code: "bad_count",
      offset: 4,
    });
  });

  it("rejects a collection count the file can't hold", () => {
    expect(readError(hex(`bb 77 33 01 40 42 0f 00 ${"00 ".repeat(40)}`))).toMatchObject({
      code: "bad_count",
      offset: 4,
    });
  });

  it("rejects a negative or oversized hash count", () => {
    const negative = hex(`${HEADER_ONE} 0b 01 41 ff ff ff ff`);
    expect(readError(negative)).toMatchObject({ code: "bad_count", offset: 11, collection: 0 });
    // 3 hashes need at least 3 bytes; 2 are left.
    const oversized = hex(`${HEADER_ONE} 0b 01 41 03 00 00 00 00 00`);
    expect(readError(oversized)).toMatchObject({ code: "bad_count", offset: 11, collection: 0 });
  });

  it("rejects other files, like osu!.db, instead of reading nonsense", () => {
    // An osu!.db starts with a version, a folder count, a flag and a date.
    const osuDb = hex("58 63 34 01  2a 00 00 00  01  00 00 00 00 00 00 00 00  0b 04 70 65 70 70");
    expect(readError(osuDb).code).toBe("bad_count");
  });

  it("keeps names and hashes out of error messages", () => {
    const bytes = hex(`${HEADER_ONE} 0b 06 53 65 63 72 65 74 01 00 00 00 0b 02 ff ff`);
    const error = readError(bytes);
    expect(error.code).toBe("invalid_utf8");
    expect(error.message).not.toContain("Secret");
  });
});

describe("readCollectionDb: input and limits", () => {
  it("reads a subarray that starts partway into its buffer", () => {
    const tv2 = hex(TV2_FARM);
    const padded = new Uint8Array(tv2.byteLength + 20).fill(0xee);
    padded.set(tv2, 7);
    const view = padded.subarray(7, 7 + tv2.byteLength);
    expect(view.byteOffset).toBe(7);
    expect(readCollectionDb(view).collections).toEqual([
      { name: "Farm", hashes: [MD5_EMPTY, MD5_A] },
    ]);
  });

  it("reads a Node Buffer", () => {
    Buffer.from([1, 2, 3]); // so the next pooled Buffer starts partway into the pool
    const buffer = Buffer.from(hex(TV2_FARM));
    expect(readCollectionDb(buffer).version).toBe(20210520);
  });

  it("throws a TypeError for anything but a Uint8Array", () => {
    const tv1 = hex(TV1_EMPTY);
    for (const input of [tv1.buffer, Array.from(tv1), TV1_EMPTY, new DataView(tv1.buffer), null]) {
      expect(() => readCollectionDb(input as unknown as Uint8Array)).toThrow(TypeError);
    }
    expect(() => readCollectionDb(new Uint8ClampedArray(8) as unknown as Uint8Array)).toThrow(
      TypeError,
    );
  });

  it("rejects input over maxBytes before reading it", () => {
    const tv4 = hex(TV4_LONG_NAME);
    expect(readCollectionDb(tv4, { maxBytes: 215 }).collections).toHaveLength(1);
    expect(readError(tv4, { maxBytes: 214 })).toMatchObject({
      code: "too_large",
      offset: null,
      collection: null,
      hash: null,
    });
    // Too large wins over garbage: nothing is read.
    expect(readError(hex(TV6_BAD_MARKER), { maxBytes: 8 }).code).toBe("too_large");
  });

  it("caps collections plus hashes at maxBytes / 34, before reading the records", () => {
    // TV2 is 1 collection and 2 hashes: 3 entries, which 102 bytes allow and 101 don't.
    const tv2 = hex(TV2_FARM);
    expect(readCollectionDb(tv2, { maxBytes: 102 }).collections).toHaveLength(1);
    expect(readError(tv2, { maxBytes: 101 })).toMatchObject({
      code: "too_large",
      offset: 14,
      collection: 0,
      hash: null,
    });
    // Three null-named empty collections: the collection count alone passes 2.
    const three = hex(`bb 77 33 01 03 00 00 00 ${"00 00 00 00 00 ".repeat(3)}`);
    expect(readCollectionDb(three, { maxBytes: 102 }).collections).toHaveLength(3);
    expect(readError(three, { maxBytes: 101 })).toMatchObject({
      code: "too_large",
      offset: 4,
      collection: null,
    });
    // Counts add up across collections: 2 collections holding a null hash each are 4 entries,
    // one over what 102 bytes allow, so the second hash count throws.
    const spread = hex(`${HEADER_TWO} 00 01 00 00 00 00  00 01 00 00 00 00`);
    expect(readCollectionDb(spread, { maxBytes: 136 }).collections).toHaveLength(2);
    expect(readError(spread, { maxBytes: 102 })).toMatchObject({
      code: "too_large",
      offset: 15,
      collection: 1,
    });
  });

  it("checks a count against the bytes left before the entry cap", () => {
    // 2 collections can't fit in 5 bytes: bad_count, even though 2 entries also pass the cap.
    const bytes = hex(`${HEADER_TWO} 00 00 00 00 00`);
    expect(readError(bytes, { maxBytes: 34 }).code).toBe("bad_count");
  });

  it("reads 64 MiB of tiny entries without building them: too_large, straight from the counts", () => {
    const size = MAX_COLLECTION_DB_BYTES;
    // One collection named "" holding a null hash (0x00) in every byte left.
    const nullHashes = new Uint8Array(size);
    nullHashes.set(hex(`bb 77 33 01 01 00 00 00 0b 00 ${int32(size - 14)}`));
    // The same collection holding empty hashes (0b 00).
    const emptyHashes = new Uint8Array(size);
    emptyHashes.set(hex(`bb 77 33 01 01 00 00 00 0b 00 ${int32((size - 14) / 2)}`));
    new Uint16Array(emptyHashes.buffer, 14).fill(0x000b);
    expect(compactHex(emptyHashes.subarray(14, 18))).toBe("0b000b00");
    // Null-named empty collections (00 00 00 00 00) filling the file.
    const count = Math.floor((size - 8) / 5);
    const emptyCollections = new Uint8Array(8 + count * 5);
    emptyCollections.set(hex(`bb 77 33 01 ${int32(count)}`));
    const started = performance.now();
    expect(readError(nullHashes)).toMatchObject({ code: "too_large", offset: 10, collection: 0 });
    expect(readError(emptyHashes)).toMatchObject({ code: "too_large", offset: 10, collection: 0 });
    expect(readError(emptyCollections)).toMatchObject({ code: "too_large", offset: 4 });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads right up to the default cap of 1,973,790 entries, keeping 1,000 warnings", () => {
    const cap = Math.floor(MAX_COLLECTION_DB_BYTES / 34);
    expect(cap).toBe(1_973_790);
    // One collection named "" (an empty_name warning) and cap - 1 null hashes: cap entries.
    const file = (nullHashes: number) => {
      const bytes = new Uint8Array(14 + nullHashes);
      bytes.set(hex(`bb 77 33 01 01 00 00 00 0b 00 ${int32(nullHashes)}`));
      return bytes;
    };
    const read = readCollectionDb(file(cap - 1));
    expect(read.collections).toEqual([{ name: "", hashes: [] }]);
    expect(read.warnings).toHaveLength(1000);
    expect(read.warnings[0]?.code).toBe("empty_name");
    expect(read.omittedWarnings).toBe(cap - 1000);
    expect(readError(file(cap))).toMatchObject({ code: "too_large", offset: 10, collection: 0 });
  });

  it("defaults maxBytes to 64 MiB", () => {
    expect(MAX_COLLECTION_DB_BYTES).toBe(64 * 1024 * 1024);
    const huge = new Uint8Array(MAX_COLLECTION_DB_BYTES + 1);
    expect(readError(huge).code).toBe("too_large");
  });

  it("throws a RangeError for a maxBytes that isn't a positive safe integer", () => {
    const tv1 = hex(TV1_EMPTY);
    for (const maxBytes of [0, -1, 1.5, Number.NaN, 2 ** 53, "86"]) {
      expect(() => readCollectionDb(tv1, { maxBytes: maxBytes as number })).toThrow(RangeError);
    }
    expect(readCollectionDb(tv1, { maxBytes: undefined }).version).toBe(20150203);
  });

  it("reads negative and zero versions as they are", () => {
    expect(readCollectionDb(hex("ff ff ff ff 00 00 00 00")).version).toBe(-1);
    expect(readCollectionDb(hex("00 00 00 00 00 00 00 00")).version).toBe(0);
    expect(readCollectionDb(hex("80 c3 c9 01 00 00 00 00")).version).toBe(30000000);
  });
});
