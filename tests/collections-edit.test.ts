/**
 * @file tests/collections-edit.test.ts
 * @desc The editing helpers: createCollectionDb, normalizeHash (and its agreement with
 *       BeatmapMeta's checksum), collectionHashesFor, addToCollection (exact names, new-name
 *       rules, no duplicates, similar names, no bare string for hashes), mergeCollections (lazer's
 *       import rules, in linear time when a name repeats), lazerImportFiles (with a lazer name
 *       used as typed), and none of them touching their inputs.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { describe, expect, it } from "vitest";
import {
  addToCollection,
  COLLECTION_DB_FILENAME,
  type CollectionDb,
  CollectionDbError,
  collectionHashesFor,
  createCollectionDb,
  DEFAULT_COLLECTION_DB_VERSION,
  lazerImportFiles,
  MAX_COLLECTION_NAME_BYTES,
  mergeCollections,
  normalizeHash,
  readCollectionDb,
  writeCollectionDb,
} from "../src/collections/index.js";
import { beatmapMetaSchema, osuBeatmapRowSchema, toBeatmapMeta } from "../src/shapes/index.js";
import {
  hex,
  MD5_A,
  MD5_ABC,
  MD5_DIGEST,
  MD5_EMPTY,
  TV1_EMPTY,
  TV2_FARM,
  TV3_UNICODE_AND_EMPTY,
  TV4_LONG_NAME,
  toHex,
} from "./collection-vectors.js";
import fixture from "./fixtures/beatmaps.json" with { type: "json" };

const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

const editError = (run: () => unknown) => {
  const error = thrown(run);
  expect(error).toBeInstanceOf(CollectionDbError);
  return error as CollectionDbError;
};

// Freezes every level, so a helper that writes to its input throws.
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const farm = (): CollectionDb => ({
  version: 20210520,
  collections: [
    { name: "Farm", hashes: [MD5_EMPTY, MD5_A] },
    { name: "Tourney", hashes: [MD5_ABC] },
  ],
});

describe("createCollectionDb", () => {
  it("makes an empty database with the default version, which writes TV1", () => {
    expect(DEFAULT_COLLECTION_DB_VERSION).toBe(20150203);
    expect(createCollectionDb()).toEqual({ version: 20150203, collections: [] });
    expect(toHex(writeCollectionDb(createCollectionDb()))).toBe(toHex(hex(TV1_EMPTY)));
  });

  it("takes a version, which must be an int32", () => {
    expect(createCollectionDb(0)).toEqual({ version: 0, collections: [] });
    expect(createCollectionDb(20210520).version).toBe(20210520);
    expect(editError(() => createCollectionDb(2 ** 31)).code).toBe("invalid_version");
    expect(editError(() => createCollectionDb(1.5)).code).toBe("invalid_version");
  });
});

describe("normalizeHash", () => {
  it("accepts 32 hex characters and lowercases them", () => {
    expect(normalizeHash(MD5_A)).toBe(MD5_A);
    expect(normalizeHash(MD5_A.toUpperCase())).toBe(MD5_A);
    expect(normalizeHash("0CC175b9C0F1b6a831c399e269772661")).toBe(MD5_A);
  });

  it("rejects anything else, and never trims", () => {
    for (const value of [
      "",
      MD5_A.slice(1),
      `${MD5_A}0`,
      ` ${MD5_A}`,
      `${MD5_A}\n`,
      MD5_A.replace("0", "g"),
      "０cc175b9c0f1b6a831c399e269772661",
    ]) {
      expect(normalizeHash(value)).toBeNull();
    }
    for (const value of [null, undefined, 1, {}]) {
      expect(normalizeHash(value as unknown as string)).toBeNull();
    }
  });

  it("agrees with BeatmapMeta's checksum: a checksum is valid exactly when it's already normal", () => {
    const checksum = beatmapMetaSchema.shape.checksum;
    for (const value of [
      MD5_A,
      MD5_EMPTY,
      MD5_A.toUpperCase(),
      "0CC175b9C0F1b6a831c399e269772661",
      MD5_A.slice(1),
      `${MD5_A}0`,
      ` ${MD5_A}`,
      MD5_A.replace("0", "g"),
      "",
    ]) {
      expect(normalizeHash(value) === value).toBe(checksum.safeParse(value).success);
    }
  });
});

describe("collectionHashesFor", () => {
  it("dedupes checksums in input order and lists items without a usable one", () => {
    type Row = { id: number; checksum?: string | null };
    const none: Row = { id: 3, checksum: null };
    const missing: Row = { id: 4 };
    const bad: Row = { id: 5, checksum: "nope" };
    const empty: Row = { id: 6, checksum: "" };
    const result = collectionHashesFor<Row>([
      { id: 1, checksum: MD5_A },
      none,
      { id: 2, checksum: MD5_EMPTY },
      missing,
      { id: 7, checksum: MD5_A.toUpperCase() },
      bad,
      { id: 8, checksum: MD5_EMPTY },
      empty,
    ]);
    expect(result.hashes).toEqual([MD5_A, MD5_EMPTY]);
    expect(result.withoutChecksum).toEqual([none, missing, bad, empty]);
    expect(result.withoutChecksum[0]).toBe(none);
  });

  it("takes BeatmapMeta and any iterable", () => {
    const meta = toBeatmapMeta(osuBeatmapRowSchema.parse(fixture.beatmaps[0]));
    expect(collectionHashesFor([meta]).hashes).toEqual(["a5b99395a42bd55bc5eb1d2411cbdf8b"]);
    const set = new Set([{ checksum: MD5_ABC }, { checksum: MD5_DIGEST }]);
    expect(collectionHashesFor(set).hashes).toEqual([MD5_ABC, MD5_DIGEST]);
    function* rows() {
      yield { checksum: MD5_A };
      yield { checksum: undefined };
    }
    expect(collectionHashesFor(rows())).toEqual({
      hashes: [MD5_A],
      withoutChecksum: [{ checksum: undefined }],
    });
  });
});

describe("addToCollection", () => {
  it("appends new hashes to the collection with that exact name", () => {
    const result = addToCollection(farm(), "Farm", [MD5_A, MD5_ABC, MD5_DIGEST]);
    expect(result).toEqual({
      db: {
        version: 20210520,
        collections: [
          { name: "Farm", hashes: [MD5_EMPTY, MD5_A, MD5_ABC, MD5_DIGEST] },
          { name: "Tourney", hashes: [MD5_ABC] },
        ],
      },
      index: 0,
      created: false,
      added: 2,
      alreadyPresent: 1,
      similarName: null,
    });
  });

  it("creates the collection at the end when no name matches exactly", () => {
    const result = addToCollection(farm(), "Practice", [MD5_DIGEST]);
    expect(result).toMatchObject({ index: 2, created: true, added: 1, alreadyPresent: 0 });
    expect(result.db.collections[2]).toEqual({ name: "Practice", hashes: [MD5_DIGEST] });
    expect(result.db.collections.slice(0, 2)).toEqual(farm().collections);
  });

  it("creates an empty collection when given no hashes", () => {
    const result = addToCollection(createCollectionDb(), "Empty", []);
    expect(result).toMatchObject({ index: 0, created: true, added: 0, alreadyPresent: 0 });
    expect(result.db.collections).toEqual([{ name: "Empty", hashes: [] }]);
  });

  it("adds to the first of two collections with the same name", () => {
    const db = {
      version: 1,
      collections: [
        { name: "A", hashes: [] },
        { name: "A", hashes: [] },
      ],
    };
    const result = addToCollection(db, "A", [MD5_A]);
    expect(result.index).toBe(0);
    expect(result.db.collections).toEqual([
      { name: "A", hashes: [MD5_A] },
      { name: "A", hashes: [] },
    ]);
  });

  it("lowercases input, skips repeats, and doesn't count an uppercase entry as present", () => {
    const db = { version: 1, collections: [{ name: "A", hashes: [MD5_A.toUpperCase()] }] };
    const result = addToCollection(db, "A", [MD5_A.toUpperCase(), MD5_A, MD5_EMPTY, MD5_EMPTY]);
    expect(result.db.collections[0]?.hashes).toEqual([MD5_A.toUpperCase(), MD5_A, MD5_EMPTY]);
    expect(result).toMatchObject({ added: 2, alreadyPresent: 2 });
  });

  it("never removes or reorders entries it doesn't understand", () => {
    const odd = ["abc", MD5_DIGEST, "", MD5_A.toUpperCase(), MD5_DIGEST];
    const db = { version: 1, collections: [{ name: "A", hashes: odd }] };
    const result = addToCollection(db, "A", [MD5_DIGEST, MD5_EMPTY]);
    expect(result.db.collections[0]?.hashes).toEqual([...odd, MD5_EMPTY]);
    expect(result).toMatchObject({ added: 1, alreadyPresent: 1 });
  });

  it("rejects an invalid hash with its position, before changing anything", () => {
    const error = editError(() => addToCollection(farm(), "Farm", [MD5_ABC, "nope", 3 as never]));
    expect(error).toMatchObject({ code: "invalid_hash", hash: 1, collection: null, offset: null });
    expect(error.message).not.toContain("nope");
  });

  it("checks a new name: not empty, not padded, no control characters or lone surrogates", () => {
    for (const name of [
      "",
      " Farm",
      "Farm ",
      "Farm\t",
      "﻿Farm",
      "Fa\nrm",
      "Fa\u0000rm",
      "Fa\u007frm",
      "Fa\u0085rm",
      "Fa\uD800rm",
      null,
      7,
    ]) {
      const error = editError(() => addToCollection(farm(), name as string, [MD5_A]));
      expect(error).toMatchObject({ code: "invalid_name", collection: null, hash: null });
    }
  });

  it("caps a new name at 127 UTF-8 bytes", () => {
    expect(MAX_COLLECTION_NAME_BYTES).toBe(127);
    expect(addToCollection(farm(), "x".repeat(127), []).created).toBe(true);
    expect(addToCollection(farm(), "練".repeat(42), []).created).toBe(true); // 126 bytes
    expect(editError(() => addToCollection(farm(), "x".repeat(128), [])).code).toBe(
      "name_too_long",
    );
    // 43 characters, 129 bytes.
    expect(editError(() => addToCollection(farm(), "練".repeat(43), [])).code).toBe(
      "name_too_long",
    );
  });

  it("refuses TV4's 200-byte name as a new name but adds to it when it exists", () => {
    const name = "a".repeat(200);
    expect(editError(() => addToCollection(createCollectionDb(), name, [])).code).toBe(
      "name_too_long",
    );
    const result = addToCollection(readCollectionDb(hex(TV4_LONG_NAME)), name, [MD5_A]);
    expect(result).toMatchObject({ created: false, index: 0, added: 1 });
  });

  it("adds to an existing collection whose name breaks the new-name rules", () => {
    const read = readCollectionDb(hex(TV3_UNICODE_AND_EMPTY));
    const result = addToCollection(read, "", [MD5_EMPTY]);
    expect(result).toMatchObject({ created: false, index: 1, added: 1 });
  });

  it("throws a TypeError for one hash string passed instead of a list, naming no hash", () => {
    const error = thrown(() => addToCollection(farm(), "Farm", MD5_ABC as unknown as string[]));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).not.toContain(MD5_ABC);
    // @ts-expect-error a single hash isn't a list of hashes
    expect(() => addToCollection(farm(), "New", MD5_ABC)).toThrow(TypeError);
    // Any other iterable is still fine.
    expect(addToCollection(farm(), "Farm", new Set([MD5_ABC])).added).toBe(1);
  });

  it("checks the new name before the hashes", () => {
    expect(editError(() => addToCollection(farm(), " x", ["nope"])).code).toBe("invalid_name");
  });

  it("names a similar existing collection when it creates one", () => {
    const similar = (existing: string, name: string) =>
      addToCollection({ version: 1, collections: [{ name: existing, hashes: [] }] }, name, [])
        .similarName;
    expect(similar("Farm", "farm")).toBe("Farm");
    expect(similar("Farm", "FARM")).toBe("Farm");
    expect(similar(" Farm ", "Farm")).toBe(" Farm ");
    expect(similar("Ｆａｒｍ", "Farm")).toBe("Ｆａｒｍ");
    expect(similar("Café", "Café")).toBe("Café");
    expect(similar("Farm", "Farms")).toBeNull();
    expect(similar("Farm", "Farm")).toBeNull(); // found, so not created
  });

  it("keeps the version and drops a read's warnings", () => {
    const read = readCollectionDb(hex(TV3_UNICODE_AND_EMPTY));
    expect(read.warnings).toHaveLength(1);
    const { db } = addToCollection(read, "練習", [MD5_EMPTY]);
    expect(Object.keys(db).sort()).toEqual(["collections", "version"]);
    expect(db.version).toBe(20150203);
  });

  it("leaves its inputs untouched", () => {
    const db = deepFreeze(farm());
    const hashes = deepFreeze([MD5_DIGEST, MD5_A]);
    const before = structuredClone(db);
    addToCollection(db, "Farm", hashes);
    addToCollection(db, "New", hashes);
    expect(db).toEqual(before);
  });

  it("round-trips with the reader and writer", () => {
    const read = readCollectionDb(hex(TV2_FARM));
    const { db } = addToCollection(read, "Farm", [MD5_ABC]);
    expect(readCollectionDb(writeCollectionDb(db)).collections).toEqual([
      { name: "Farm", hashes: [MD5_EMPTY, MD5_A, MD5_ABC] },
    ]);
  });
});

describe("mergeCollections", () => {
  it("merges each source collection into the same-named one, or creates it at the end", () => {
    const source = {
      version: 30000000,
      collections: [
        { name: "Farm", hashes: [MD5_A.toUpperCase(), MD5_DIGEST] },
        { name: "New", hashes: [MD5_ABC, MD5_ABC, "nope"] },
        { name: "farm", hashes: [MD5_EMPTY] },
        { name: "New", hashes: [MD5_A, MD5_ABC] },
        { name: "", hashes: [] },
      ],
    };
    expect(mergeCollections(farm(), source)).toEqual({
      db: {
        version: 20210520,
        collections: [
          { name: "Farm", hashes: [MD5_EMPTY, MD5_A, MD5_DIGEST] },
          { name: "Tourney", hashes: [MD5_ABC] },
          { name: "New", hashes: [MD5_ABC, MD5_A] },
          { name: "farm", hashes: [MD5_EMPTY] },
          { name: "", hashes: [] },
        ],
      },
      created: 3,
      added: 4,
      alreadyPresent: 3,
      invalid: 1,
    });
  });

  it("merges into the first of two target collections with the same name", () => {
    const target = {
      version: 1,
      collections: [
        { name: "A", hashes: [MD5_A] },
        { name: "A", hashes: [] },
      ],
    };
    const source = { version: 2, collections: [{ name: "A", hashes: [MD5_EMPTY] }] };
    expect(mergeCollections(target, source).db.collections).toEqual([
      { name: "A", hashes: [MD5_A, MD5_EMPTY] },
      { name: "A", hashes: [] },
    ]);
  });

  it("merges a file read from bytes", () => {
    const result = mergeCollections(
      readCollectionDb(hex(TV2_FARM)),
      readCollectionDb(hex(TV3_UNICODE_AND_EMPTY)),
    );
    expect(result.db.collections).toEqual([
      { name: "Farm", hashes: [MD5_EMPTY, MD5_A] },
      { name: "練習", hashes: [MD5_A] },
      { name: "", hashes: [] },
    ]);
    expect(result.db.version).toBe(20210520);
  });

  it("throws a TypeError for a source collection whose hashes aren't an array", () => {
    for (const collection of [{ name: "Farm", hashes: MD5_ABC }, { name: "Farm" }, null]) {
      const source = { version: 1, collections: [collection] } as unknown as CollectionDb;
      const error = thrown(() => mergeCollections(farm(), source));
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).not.toContain(MD5_ABC);
    }
  });

  it("stays linear when the source repeats one name many times", () => {
    const hash = (i: number) => i.toString(16).padStart(32, "0");
    // 40,000 collections named "a", one hash each.
    const repeated = {
      version: 1,
      collections: Array.from({ length: 40_000 }, (_, i) => ({ name: "a", hashes: [hash(i)] })),
    };
    // One "a" of 100,000 hashes, then 2,000 empty collections also named "a".
    const bigThenEmpty = {
      version: 1,
      collections: [
        { name: "a", hashes: Array.from({ length: 100_000 }, (_, i) => hash(i)) },
        ...Array.from({ length: 2_000 }, () => ({ name: "a", hashes: [] })),
      ],
    };
    const started = performance.now();
    const first = mergeCollections(farm(), repeated);
    const second = mergeCollections(first.db, bigThenEmpty);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(first).toMatchObject({ created: 1, added: 40_000, alreadyPresent: 0, invalid: 0 });
    expect(second).toMatchObject({ created: 0, added: 60_000, alreadyPresent: 40_000 });
    expect(second.db.collections.map((collection) => collection.name)).toEqual([
      "Farm",
      "Tourney",
      "a",
    ]);
    expect(second.db.collections[2]?.hashes).toEqual(
      Array.from({ length: 100_000 }, (_, i) => hash(i)),
    );
    // The target's own lists come through untouched.
    expect(second.db.collections[0]).toBe(first.db.collections[0]);
  });

  it("leaves its inputs untouched", () => {
    const target = deepFreeze(farm());
    const source = deepFreeze({
      version: 1,
      collections: [
        { name: "Farm", hashes: [MD5_DIGEST] },
        { name: "X", hashes: [MD5_A] },
      ],
    });
    const before = structuredClone([target, source]);
    mergeCollections(target, source);
    expect([target, source]).toEqual(before);
  });
});

describe("lazerImportFiles", () => {
  it("returns collection.db and an empty osu!.import.cfg, both at the root", () => {
    const db = addToCollection(createCollectionDb(), "Tourney practice", [MD5_A]).db;
    const files = lazerImportFiles(db);
    expect(files.map((file) => file.path)).toEqual([COLLECTION_DB_FILENAME, "osu!.import.cfg"]);
    expect(COLLECTION_DB_FILENAME).toBe("collection.db");
    expect(toHex(files[0]?.bytes ?? new Uint8Array())).toBe(toHex(writeCollectionDb(db)));
    expect(files[1]?.bytes.byteLength).toBe(0);
    // Lazer takes a folder holding a file named osu!.*.cfg as a stable install.
    expect(files[1]?.path).toMatch(/^osu!\..+\.cfg$/);
  });

  it("takes a lazer collection's name exactly as typed, even one addToCollection wouldn't create", () => {
    // The README's lazer delta: the typed name as is, so it matches lazer's collection exactly.
    for (const name of ["Farm ", "my\tfarm", "練".repeat(43)]) {
      expect(editError(() => addToCollection(createCollectionDb(), name, [MD5_A])).code).toMatch(
        /^(invalid_name|name_too_long)$/,
      );
      const delta = { ...createCollectionDb(), collections: [{ name, hashes: [MD5_A] }] };
      const [file] = lazerImportFiles(delta);
      expect(readCollectionDb(file?.bytes ?? new Uint8Array()).collections).toEqual([
        { name, hashes: [MD5_A] },
      ]);
    }
  });

  it("throws the writer's errors", () => {
    const db = { version: 1, collections: [{ name: "\uD800", hashes: [] }] };
    expect(editError(() => lazerImportFiles(db)).code).toBe("invalid_name");
  });
});

describe("CollectionDbError", () => {
  it("is an Error with a code and null positions by default", () => {
    const error = new CollectionDbError("truncated", "x");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "CollectionDbError",
      code: "truncated",
      message: "x",
      offset: null,
      collection: null,
      hash: null,
    });
    expect(
      new CollectionDbError("bad_count", "y", { offset: 4, collection: 1, hash: 2 }),
    ).toMatchObject({
      offset: 4,
      collection: 1,
      hash: 2,
    });
  });
});
