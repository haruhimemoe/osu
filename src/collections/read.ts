/**
 * @file src/collections/read.ts
 * @desc readCollectionDb: a strict, single-pass reader for osu!stable's collection.db. It keeps
 *       everything it finds (order, names, odd hashes) and reports oddities as warnings, so a
 *       stable-written file comes back out of the writer byte for byte. Every count is checked
 *       against the bytes left and against an entry budget before anything is built from it, and
 *       only the first 1,000 warnings are kept, so a hostile file can't use much more memory than
 *       a real one of the same size limit.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { CollectionDbError, type CollectionDbErrorCode } from "./errors.js";
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

const NULL_MARKER = 0x00;
const STRING_MARKER = 0x0b;
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
/** .NET reads a string length in at most 5 bytes, and the 5th can't take it past 2^31 - 1. */
const MAX_LENGTH_BYTES = 5;
const MAX_LAST_LENGTH_BYTE = 0x07;

// Where a field sits, for messages: the name or a hash of a collection.
const describe = (collection: number, hash: number | null): string =>
  hash === null ? `collection ${collection}'s name` : `collection ${collection}, hash ${hash}`;

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
  const end = bytes.byteLength;
  if (end > maxBytes) {
    throw new CollectionDbError(
      "too_large",
      `collection.db is ${end} bytes, over the ${maxBytes}-byte limit`,
    );
  }

  const maxEntries = Math.floor(maxBytes / ENTRY_BYTES);

  const view = new DataView(bytes.buffer, bytes.byteOffset, end);
  const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let loose: TextDecoder | undefined;
  const warnings: CollectionDbWarning[] = [];
  let omittedWarnings = 0;
  let offset = 0;

  const fail = (
    code: CollectionDbErrorCode,
    message: string,
    at: number,
    collection: number | null = null,
    hash: number | null = null,
  ) => new CollectionDbError(code, message, { offset: at, collection, hash });
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
      throw fail(
        "too_large",
        `the counts up to byte ${at} claim ${entries} collections and hashes, over the ${maxEntries} a ${maxBytes}-byte limit allows`,
        at,
        collection,
      );
    }
  };

  const readInt32 = (field: string, collection: number | null): number => {
    if (end - offset < 4) {
      throw fail("truncated", `the file ends in ${field} at byte ${offset}`, offset, collection);
    }
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };

  // An osu! string: a marker byte, then (for 0x0b) a ULEB128 byte length and UTF-8. Null for 0x00.
  // `hash` is the hash's place in the file, for errors; `index` is where it lands in `hashes`, for
  // warnings. Both are null for a name.
  const readString = (
    collection: number,
    hash: number | null,
    index: number | null,
  ): string | null => {
    const field = describe(collection, hash);
    const markerAt = offset;
    if (markerAt >= end) {
      throw fail("truncated", `the file ends before ${field}`, markerAt, collection, hash);
    }
    const marker = bytes[offset++] as number;
    if (marker === NULL_MARKER) return null;
    if (marker !== STRING_MARKER) {
      if (!lenient) {
        throw fail(
          "bad_marker",
          `${field} has string marker 0x${marker.toString(16).padStart(2, "0")} at byte ${markerAt}, not 0x00 or 0x0b`,
          markerAt,
          collection,
          hash,
        );
      }
      warn("unknown_marker", markerAt, collection, index);
    }

    const lengthAt = offset;
    let length = 0;
    for (let i = 0; ; i++) {
      if (offset >= end) {
        throw fail("truncated", `the file ends in ${field}'s length`, lengthAt, collection, hash);
      }
      const byte = bytes[offset++] as number;
      if (i === MAX_LENGTH_BYTES - 1 && byte > MAX_LAST_LENGTH_BYTE) {
        throw fail(
          "bad_length",
          `${field}'s length at byte ${lengthAt} takes more than 5 bytes or passes 2^31 - 1`,
          lengthAt,
          collection,
          hash,
        );
      }
      length += (byte & 0x7f) * 2 ** (7 * i);
      if (byte < 0x80) break;
    }
    if (length > end - offset) {
      throw fail(
        "bad_length",
        `${field}'s length at byte ${lengthAt} runs past the end of the file`,
        lengthAt,
        collection,
        hash,
      );
    }

    const start = offset;
    offset += length;
    const encoded = bytes.subarray(start, offset);
    try {
      return strict.decode(encoded);
    } catch {
      if (!lenient) {
        throw fail(
          "invalid_utf8",
          `${field} at byte ${start} isn't valid UTF-8`,
          start,
          collection,
          hash,
        );
      }
      warn("invalid_utf8", start, collection, index);
      loose ??= new TextDecoder("utf-8", { ignoreBOM: true });
      return loose.decode(encoded);
    }
  };

  if (end < 8) {
    const at = end < 4 ? 0 : 4;
    throw fail(
      "truncated",
      `the file ends in its ${at === 0 ? "version" : "collection count"}`,
      at,
    );
  }
  const version = readInt32("the version", null);
  const count = readInt32("the collection count", null);
  if (count < 0 || count * MIN_COLLECTION_BYTES > end - offset) {
    throw fail(
      "bad_count",
      `the collection count at byte 4 (${count}) doesn't fit in the ${end - offset} bytes left`,
      4,
    );
  }
  claim(count, 4, null);

  const collections: OsuCollection[] = [];
  const names = new Set<string>();
  for (let c = 0; c < count; c++) {
    const nameAt = offset;
    const read = readString(c, null, null);
    const name = read ?? "";
    if (read === null) warn("null_name", nameAt, c, null);
    else if (name === "") warn("empty_name", nameAt, c, null);
    if (names.has(name)) warn("duplicate_name", nameAt, c, null);
    else names.add(name);

    const countAt = offset;
    const hashCount = readInt32(`collection ${c}'s hash count`, c);
    if (hashCount < 0 || hashCount * MIN_HASH_BYTES > end - offset) {
      throw fail(
        "bad_count",
        `collection ${c}'s hash count at byte ${countAt} (${hashCount}) doesn't fit in the ${end - offset} bytes left`,
        countAt,
        c,
      );
    }
    claim(hashCount, countAt, c);
    const hashes: string[] = [];
    // Only a collection with two or more hashes can hold a duplicate.
    const seen = hashCount > 1 ? new Set<string>() : null;
    for (let h = 0; h < hashCount; h++) {
      const hashAt = offset;
      const index = hashes.length;
      const hash = readString(c, h, index);
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

  if (offset < end) {
    if (!lenient) {
      throw fail(
        "trailing_bytes",
        `${end - offset} bytes follow the last collection, from byte ${offset}`,
        offset,
      );
    }
    warn("trailing_bytes", offset, null, null);
  }
  return { version, collections, warnings, omittedWarnings };
};
