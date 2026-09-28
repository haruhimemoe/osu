/**
 * @file src/collections/cursor.ts
 * @desc The byte cursor readCollectionDb walks a file with: little-endian int32s and osu! strings
 *       (a marker byte, a ULEB128 length as .NET writes it, then UTF-8). Every read checks the
 *       bytes left before it takes any, and errors carry byte offsets, never the text.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { CollectionDbError, type CollectionDbErrorCode } from "./errors.js";
import { STRING_MARKER } from "./model.js";

const NULL_MARKER = 0x00;
/** .NET reads a string length in at most 5 bytes, and the 5th can't take it past 2^31 - 1. */
const MAX_LENGTH_BYTES = 5;
const MAX_LAST_LENGTH_BYTE = 0x07;

/** Reports an oddity lenient mode reads past, at a byte offset and where it lands. */
export type CursorWarn = (
  code: "unknown_marker" | "invalid_utf8",
  at: number,
  collection: number,
  hash: number | null,
) => void;

/** What createCursor returns. */
export type Cursor = {
  /** Where the next read starts. */
  readonly offset: number;
  /** How many bytes are left to read. */
  left: () => number;
  /** The next little-endian int32; `field` and `collection` go in a "truncated" error. */
  readInt32: (field: string, collection: number | null) => number;
  /**
   * The next osu! string, or null for a 0x00 marker. `hash` is the hash's place in the file, for
   * errors; `index` is where it lands in `hashes`, for warnings. Both are null for a name.
   */
  readString: (collection: number, hash: number | null, index: number | null) => string | null;
};

/**
 * @function readError
 * @param code {CollectionDbErrorCode} what went wrong
 * @param message {string} the field and position, never a name or hash
 * @param at {number} byte offset of the field
 * @param collection {number | null} the collection's index, when there is one
 * @param hash {number | null} the hash's place in that collection's list in the file
 * @returns {CollectionDbError} the error to throw
 */
export const readError = (
  code: CollectionDbErrorCode,
  message: string,
  at: number,
  collection: number | null = null,
  hash: number | null = null,
): CollectionDbError => new CollectionDbError(code, message, { offset: at, collection, hash });

// Where a field sits, for messages: the name or a hash of a collection.
const describe = (collection: number, hash: number | null): string =>
  hash === null ? `collection ${collection}'s name` : `collection ${collection}, hash ${hash}`;

/**
 * @function createCursor
 * @param bytes {Uint8Array} the whole file
 * @param lenient {boolean} read an unknown marker as a string, and invalid UTF-8 with U+FFFD,
 *        each with a warning, instead of throwing
 * @param warn {CursorWarn} gets those warnings
 * @returns {Cursor} a cursor at byte 0
 */
export const createCursor = (bytes: Uint8Array, lenient: boolean, warn: CursorWarn): Cursor => {
  const end = bytes.byteLength;
  const view = new DataView(bytes.buffer, bytes.byteOffset, end);
  const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let loose: TextDecoder | undefined;
  let offset = 0;

  const readInt32 = (field: string, collection: number | null): number => {
    if (end - offset < 4) {
      throw readError(
        "truncated",
        `the file ends in ${field} at byte ${offset}`,
        offset,
        collection,
      );
    }
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };

  // A ULEB128 byte length, checked against .NET's limits and against the bytes left.
  const readLength = (field: string, collection: number, hash: number | null): number => {
    const lengthAt = offset;
    let length = 0;
    for (let i = 0; ; i++) {
      if (offset >= end) {
        throw readError(
          "truncated",
          `the file ends in ${field}'s length`,
          lengthAt,
          collection,
          hash,
        );
      }
      const byte = bytes[offset++] as number;
      if (i === MAX_LENGTH_BYTES - 1 && byte > MAX_LAST_LENGTH_BYTE) {
        throw readError(
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
      throw readError(
        "bad_length",
        `${field}'s length at byte ${lengthAt} runs past the end of the file`,
        lengthAt,
        collection,
        hash,
      );
    }
    return length;
  };

  const readString = (
    collection: number,
    hash: number | null,
    index: number | null,
  ): string | null => {
    const field = describe(collection, hash);
    const markerAt = offset;
    if (markerAt >= end) {
      throw readError("truncated", `the file ends before ${field}`, markerAt, collection, hash);
    }
    const marker = bytes[offset++] as number;
    if (marker === NULL_MARKER) return null;
    if (marker !== STRING_MARKER) {
      if (!lenient) {
        throw readError(
          "bad_marker",
          `${field} has string marker 0x${marker.toString(16).padStart(2, "0")} at byte ${markerAt}, not 0x00 or 0x0b`,
          markerAt,
          collection,
          hash,
        );
      }
      warn("unknown_marker", markerAt, collection, index);
    }

    const length = readLength(field, collection, hash);
    const start = offset;
    offset += length;
    const encoded = bytes.subarray(start, offset);
    try {
      return strict.decode(encoded);
    } catch {
      if (!lenient) {
        throw readError(
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

  return {
    get offset() {
      return offset;
    },
    left: () => end - offset,
    readInt32,
    readString,
  };
};
