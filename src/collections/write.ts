/**
 * @file src/collections/write.ts
 * @desc writeCollectionDb: writes a CollectionDb exactly as given (no lowercasing, deduplicating
 *       or reordering) in osu!stable's collection.db layout. It checks everything and works out
 *       the exact size before allocating one buffer, and writes what .NET writes (0x0b markers,
 *       the shortest ULEB128 length), so a stable-written file round-trips byte for byte.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { CollectionDbError } from "./errors.js";
import {
  type CollectionDb,
  isInt32,
  maxBytesOption,
  type OsuCollection,
  utf8Length,
} from "./model.js";

const STRING_MARKER = 0x0b;

// Bytes a ULEB128 length takes.
const lengthSize = (length: number): number => {
  let size = 1;
  for (let rest = length; rest >= 0x80; rest = Math.floor(rest / 0x80)) size++;
  return size;
};

// UTF-8 length of a string with no lone surrogates, else -1.
const textLength = (value: unknown): number => (typeof value === "string" ? utf8Length(value) : -1);

/**
 * @function writeCollectionDb
 * @param db {CollectionDb} the version and collections to write
 * @param options {{ maxBytes?: number }} largest output allowed, default MAX_COLLECTION_DB_BYTES
 * @returns {Uint8Array<ArrayBuffer>} the file, over its own ArrayBuffer (ready for a Blob)
 * @throws {CollectionDbError} invalid_version, invalid_name, invalid_hash, then too_large
 * @throws {TypeError} when db isn't shaped like a CollectionDb; RangeError for a bad maxBytes
 */
export const writeCollectionDb = (
  db: CollectionDb,
  options: { maxBytes?: number | undefined } = {},
): Uint8Array<ArrayBuffer> => {
  const maxBytes = maxBytesOption(options.maxBytes, "writeCollectionDb");
  if (typeof db !== "object" || db === null || !Array.isArray(db.collections)) {
    throw new TypeError("writeCollectionDb: db must be { version, collections: [...] }");
  }
  // Annotated: Array.isArray narrows a readonly array to any[].
  const version: unknown = db.version;
  const collections: readonly OsuCollection[] = db.collections;
  if (!isInt32(version)) {
    throw new CollectionDbError(
      "invalid_version",
      "version must be an integer from -2^31 to 2^31 - 1",
    );
  }

  let size = 8;
  for (let c = 0; c < collections.length; c++) {
    const collection = collections[c];
    if (
      typeof collection !== "object" ||
      collection === null ||
      !Array.isArray(collection.hashes)
    ) {
      throw new TypeError(`writeCollectionDb: collection ${c} must be { name, hashes: [...] }`);
    }
    const length = textLength(collection.name);
    if (length < 0) {
      throw new CollectionDbError(
        "invalid_name",
        `collection ${c}'s name must be a string with no lone surrogates`,
        { collection: c },
      );
    }
    size += 1 + lengthSize(length) + length + 4;
  }
  for (let c = 0; c < collections.length; c++) {
    const { hashes } = collections[c] as OsuCollection;
    for (let h = 0; h < hashes.length; h++) {
      const length = textLength(hashes[h]);
      if (length < 0) {
        throw new CollectionDbError(
          "invalid_hash",
          `collection ${c}, hash ${h} must be a string with no lone surrogates`,
          { collection: c, hash: h },
        );
      }
      size += 1 + lengthSize(length) + length;
    }
  }
  if (size > maxBytes) {
    throw new CollectionDbError(
      "too_large",
      `collection.db would be ${size} bytes, over the ${maxBytes}-byte limit`,
    );
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  let offset = 0;
  const writeInt32 = (value: number) => {
    view.setInt32(offset, value, true);
    offset += 4;
  };
  const writeString = (text: string) => {
    bytes[offset++] = STRING_MARKER;
    const length = utf8Length(text);
    let rest = length;
    for (; rest >= 0x80; rest = Math.floor(rest / 0x80)) bytes[offset++] = (rest & 0x7f) | 0x80;
    bytes[offset++] = rest;
    if (length === text.length) {
      // ASCII, like every real hash: one byte per character.
      for (let i = 0; i < length; i++) bytes[offset + i] = text.charCodeAt(i);
    } else {
      encoder.encodeInto(text, bytes.subarray(offset, offset + length));
    }
    offset += length;
  };

  writeInt32(version);
  writeInt32(collections.length);
  for (const { name, hashes } of collections) {
    writeString(name);
    writeInt32(hashes.length);
    for (const hash of hashes) writeString(hash);
  }
  return bytes;
};
