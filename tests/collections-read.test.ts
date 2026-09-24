/**
 * @file tests/collections-read.test.ts
 * @desc readCollectionDb against hand-built vectors: the stable layout, osu! strings (ULEB128
 *       byte lengths, the null marker, non-ASCII UTF-8, a leading BOM), warnings for oddities it
 *       keeps, and a CollectionDbError with a code and byte offset for truncated or garbage input.
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
} from "./collection-vectors.js";

const HEADER_ONE = "bb 77 33 01  01 00 00 00"; // version 20150203, 1 collection
const HEADER_TWO = "bb 77 33 01  02 00 00 00"; // version 20150203, 2 collections

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
    });
  });

  it("reads TV2, one collection with two hashes", () => {
    const bytes = hex(TV2_FARM);
    expect(bytes.byteLength).toBe(86);
    expect(readCollectionDb(bytes)).toEqual({
      version: 20210520,
      collections: [{ name: "Farm", hashes: [MD5_EMPTY, MD5_A] }],
      warnings: [],
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
    });
  });

  it("rejects TV7's count: 2 collections can't fit in the 7 bytes left", () => {
    // Every collection takes at least 5 bytes (marker and hash count), checked before reading.
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
        { code: "null_hash", offset: 122, collection: 0, hash: 4 },
        { code: "duplicate_name", offset: 123, collection: 1, hash: null },
      ],
    });
  });

  it("counts null hashes in a hash's position", () => {
    const bytes = hex(`${HEADER_ONE} 0b 01 41 02 00 00 00 00 0b 03 61 62 63`);
    expect(readCollectionDb(bytes)).toMatchObject({
      collections: [{ name: "A", hashes: ["abc"] }],
      warnings: [
        { code: "null_hash", offset: 15, hash: 0 },
        { code: "malformed_hash", offset: 16, hash: 1 },
      ],
    });
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
    const tv2 = hex(TV2_FARM);
    expect(readCollectionDb(tv2, { maxBytes: 86 }).collections).toHaveLength(1);
    expect(readError(tv2, { maxBytes: 85 })).toMatchObject({
      code: "too_large",
      offset: null,
      collection: null,
      hash: null,
    });
    // Too large wins over garbage: nothing is read.
    expect(readError(hex(TV6_BAD_MARKER), { maxBytes: 8 }).code).toBe("too_large");
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
