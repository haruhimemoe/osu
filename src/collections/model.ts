/**
 * @file src/collections/model.ts
 * @desc The collection.db model (a version and named lists of difficulty MD5s), its limits, and
 *       the checks the reader, the writer and the helpers share. Imports nothing at runtime.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

/** One collection: its name and its difficulty MD5s, in file order. */
export type OsuCollection = { name: string; hashes: readonly string[] };

/** A collection.db. `version` is stable's build date (YYYYMMDD); no client reads it. */
export type CollectionDb = { version: number; collections: readonly OsuCollection[] };

/**
 * Largest collection.db read or written by default: 64 MiB, about 1.9 million hashes. The reader
 * also caps collections plus hashes at maxBytes / 34 (1,973,790 at this default).
 */
export const MAX_COLLECTION_DB_BYTES = 64 * 1024 * 1024;
/**
 * Longest new collection name, in UTF-8 bytes: the longest whose length fits in one byte, so
 * files we create stay readable by tools that mishandle longer lengths. Existing names can be longer.
 */
export const MAX_COLLECTION_NAME_BYTES = 127;
/** The version written into new files. Nothing reads it; this value has the longest track record. */
export const DEFAULT_COLLECTION_DB_VERSION = 20150203;
/** osu!stable's file name for it, in the install folder next to osu!.db. */
export const COLLECTION_DB_FILENAME = "collection.db";

/** 32 hex characters in any case. */
export const HEX_32 = /^[0-9a-fA-F]{32}$/;
/** A lowercase MD5, as osu! computes it (and as BeatmapMeta's checksum requires). */
export const LOWERCASE_MD5 = /^[0-9a-f]{32}$/;

/**
 * @function isInt32
 * @param value {unknown} anything
 * @returns {boolean} whether it's an integer from -2^31 to 2^31 - 1
 */
export const isInt32 = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= -(2 ** 31) && (value as number) <= 2 ** 31 - 1;

/**
 * @function utf8Length
 * @param text {string} any string
 * @returns {number} its length in UTF-8 bytes, or -1 when it holds a lone surrogate (which UTF-8
 *          can't encode: TextEncoder would silently write U+FFFD in its place)
 */
export const utf8Length = (text: string): number => {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) length += 1;
    else if (unit < 0x800) length += 2;
    else if (unit < 0xd800 || unit > 0xdfff) length += 3;
    else {
      // A high surrogate followed by a low one is one 4-byte code point; anything else is lone.
      const next = text.charCodeAt(i + 1);
      if (unit > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) return -1;
      length += 4;
      i++;
    }
  }
  return length;
};

/**
 * @function maxBytesOption
 * @param maxBytes {unknown} the caller's maxBytes option
 * @param caller {string} the function name, for the message
 * @returns {number} the limit, MAX_COLLECTION_DB_BYTES when not given
 */
export const maxBytesOption = (maxBytes: unknown, caller: string): number => {
  if (maxBytes === undefined) return MAX_COLLECTION_DB_BYTES;
  if (!Number.isSafeInteger(maxBytes) || (maxBytes as number) <= 0) {
    throw new RangeError(`${caller}: maxBytes must be a positive safe integer`);
  }
  return maxBytes as number;
};
