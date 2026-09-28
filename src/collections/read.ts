/**
 * @file src/collections/read.ts
 * @desc readCollectionDb: a strict, single-pass reader for osu!stable's collection.db. It keeps
 *       everything it finds (order, names, odd hashes) and reports oddities as warnings, so a
 *       stable-written file comes back out of the writer byte for byte. Every count is checked
 *       against the bytes left and against an entry budget before anything is built from it, and
 *       only the first 1,000 warnings are kept, so a hostile file can't use much more memory than
 *       a real one of the same size limit. The byte-level reads live in cursor.ts.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Mon Sep 28, 2026
 */

import { createCursor, readError } from "./cursor.js";
import { CollectionDbError } from "./errors.js";
import {
  type CollectionDb,
  HEX_32,
  LOWERCASE_MD5,
  maxBytesOption,
  type OsuCollection,
} from "./model.js";

/**
 * Something odd the reader kept (or dropped, for "null_hash" and "trailing_bytes"): "null_name"
 * (a 0x00 name marker, read as ""), "empty_name", "duplicate_name" (the same exact name as an
 * earlier collection), "null_hash" (a 0x00 hash marker, dropped), "duplicate_hash" (the same hash
 * earlier in this collection), "uppercase_hash" (32 hex characters with some uppercase, which
 * lazer never matches), "malformed_hash" (not 32 hex characters), and, in lenient mode only,
 * "unknown_marker", "invalid_utf8" and "trailing_bytes". Later versions may add codes.
 */
export type CollectionDbWarningCode =
  | "null_name"
  | "empty_name"
  | "duplicate_name"
  | "null_hash"
  | "duplicate_hash"
  | "uppercase_hash"
  | "malformed_hash"
  | "unknown_marker"
  | "invalid_utf8"
  | "trailing_bytes"
  | (string & {});

/** Something odd the reader found, where it is, and which entry it's about. */
export type CollectionDbWarning = {
  code: CollectionDbWarningCode;
  /** Byte offset in the file of the field in question. */
  offset: number;
  /** Index into collections, or null for "trailing_bytes". */
  collection: number | null;
  /**
   * Index into that collection's `hashes`, or null for a warning about a name and for a
   * "null_hash" (it was dropped, so `offset` is the only place it has).
   */
  hash: number | null;
};

/**
 * A read database, plus anything odd the reader found in it: the first 1,000 warnings, in file
 * order, and how many more there were.
 */
export type CollectionDbRead = CollectionDb & {
  warnings: readonly CollectionDbWarning[];
  /** Warnings past the first 1,000: counted, not listed. */
  omittedWarnings: number;
};

/** readCollectionDb's options. */
export type ReadCollectionDbOptions = {
  /**
   * Largest input accepted, in bytes. Default MAX_COLLECTION_DB_BYTES (64 MiB). It also caps
   * collections plus hashes at maxBytes / 34 (a real hash's size), 1,973,790 by default.
   */
  maxBytes?: number | undefined;
  /**
   * Read the way lazer does: an unknown string marker, invalid UTF-8 (replaced with U+FFFD) and
   * bytes after the last collection become warnings instead of errors. Default false.
   */
  lenient?: boolean | undefined;
};

/** A collection takes at least a marker byte and a 4-byte hash count. */
const MIN_COLLECTION_BYTES = 5;
/** A hash takes at least a marker byte. */
const MIN_HASH_BYTES = 1;
/**
 * A real hash takes 34 bytes (a marker, a length and 32 characters). Collections plus hashes are
 * capped at maxBytes / 34, what a file of maxBytes holds, because a hostile file can pack an entry
 * into every byte or two and each entry costs far more memory than that.
 */
const ENTRY_BYTES = 34;
/** Warnings listed in a read; the rest are only counted. */
const MAX_WARNINGS = 1000;

/**
 * @function readCollectionDb
 * @param bytes {Uint8Array} the whole file (a Node Buffer works too)
 * @param options {ReadCollectionDbOptions} maxBytes and lenient
 * @returns {CollectionDbRead} the version, the collections in file order, the first 1,000
 *          warnings and a count of the rest
 * @throws {CollectionDbError} for a file it can't read (see CollectionDbErrorCode), including
 *         too_large for more than maxBytes bytes or maxBytes / 34 collections plus hashes
 * @throws {TypeError} when bytes isn't a Uint8Array; RangeError for a bad maxBytes
 */
export const readCollectionDb = (
  bytes: Uint8Array,
  options: ReadCollectionDbOptions = {},
): CollectionDbRead => {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("readCollectionDb: bytes must be a Uint8Array");
  }
  const maxBytes = maxBytesOption(options.maxBytes, "readCollectionDb");
  const lenient = options.lenient === true;
  const size = bytes.byteLength;
  if (size > maxBytes) {
    throw new CollectionDbError(
      "too_large",
      `collection.db is ${size} bytes, over the ${maxBytes}-byte limit`,
    );
  }

  const maxEntries = Math.floor(maxBytes / ENTRY_BYTES);
  const warnings: CollectionDbWarning[] = [];
  let omittedWarnings = 0;
  const warn = (
    code: CollectionDbWarningCode,
    at: number,
    collection: number | null,
    hash: number | null,
  ) => {
    if (warnings.length < MAX_WARNINGS) warnings.push({ code, offset: at, collection, hash });
    else omittedWarnings++;
  };
  // Throws once the counts read so far claim more entries than maxBytes allows.
  let entries = 0;
  const claim = (count: number, at: number, collection: number | null) => {
    entries += count;
    if (entries > maxEntries) {
      throw readError(
        "too_large",
        `the counts up to byte ${at} claim ${entries} collections and hashes, over the ${maxEntries} a ${maxBytes}-byte limit allows`,
        at,
        collection,
      );
    }
  };
  const cursor = createCursor(bytes, lenient, warn);

  if (size < 8) {
    const at = size < 4 ? 0 : 4;
    throw readError(
      "truncated",
      `the file ends in its ${at === 0 ? "version" : "collection count"}`,
      at,
    );
  }
  const version = cursor.readInt32("the version", null);
  const count = cursor.readInt32("the collection count", null);
  if (count < 0 || count * MIN_COLLECTION_BYTES > cursor.left()) {
    throw readError(
      "bad_count",
      `the collection count at byte 4 (${count}) doesn't fit in the ${cursor.left()} bytes left`,
      4,
    );
  }
  claim(count, 4, null);

  const collections: OsuCollection[] = [];
  const names = new Set<string>();
  for (let c = 0; c < count; c++) {
    const nameAt = cursor.offset;
    const read = cursor.readString(c, null, null);
    const name = read ?? "";
    if (read === null) warn("null_name", nameAt, c, null);
    else if (name === "") warn("empty_name", nameAt, c, null);
    if (names.has(name)) warn("duplicate_name", nameAt, c, null);
    else names.add(name);

    const countAt = cursor.offset;
    const hashCount = cursor.readInt32(`collection ${c}'s hash count`, c);
    if (hashCount < 0 || hashCount * MIN_HASH_BYTES > cursor.left()) {
      throw readError(
        "bad_count",
        `collection ${c}'s hash count at byte ${countAt} (${hashCount}) doesn't fit in the ${cursor.left()} bytes left`,
        countAt,
        c,
      );
    }
    claim(hashCount, countAt, c);
    const hashes: string[] = [];
    // Only a collection with two or more hashes can hold a duplicate.
    const seen = hashCount > 1 ? new Set<string>() : null;
    for (let h = 0; h < hashCount; h++) {
      const hashAt = cursor.offset;
      const index = hashes.length;
      const hash = cursor.readString(c, h, index);
      if (hash === null) {
        warn("null_hash", hashAt, c, null);
        continue;
      }
      if (!LOWERCASE_MD5.test(hash)) {
        warn(HEX_32.test(hash) ? "uppercase_hash" : "malformed_hash", hashAt, c, index);
      }
      if (seen?.has(hash)) warn("duplicate_hash", hashAt, c, index);
      else seen?.add(hash);
      hashes.push(hash);
    }
    collections.push({ name, hashes });
  }

  if (cursor.left() > 0) {
    const at = cursor.offset;
    if (!lenient) {
      throw readError(
        "trailing_bytes",
        `${cursor.left()} bytes follow the last collection, from byte ${at}`,
        at,
      );
    }
    warn("trailing_bytes", at, null, null);
  }
  return { version, collections, warnings, omittedWarnings };
};
