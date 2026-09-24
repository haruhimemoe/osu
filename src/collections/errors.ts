/**
 * @file src/collections/errors.ts
 * @desc CollectionDbError: a problem in the data (the file, a hash, a new name), with a code and
 *       where it happened. Messages name the field and position, never a name or a hash.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

/**
 * What went wrong: "too_large" (input or output over maxBytes, or a file whose counts add up to
 * more than maxBytes / 34 collections and hashes), "truncated" (the file ends partway through a
 * field, or is under 8 bytes), "bad_count" (a negative count, or one the bytes left can't hold;
 * each count is checked before its entries are read, so a file cut off soon after a count gets
 * this rather than "truncated"), "bad_marker" (a string marker other than 0x00 or 0x0b),
 * "bad_length" (a string length over 5 bytes, over 2^31 - 1, or running past the end),
 * "invalid_utf8", "trailing_bytes" (bytes after the last collection), "invalid_version",
 * "invalid_name", "name_too_long" (a new name over MAX_COLLECTION_NAME_BYTES) or "invalid_hash".
 * Branch on the ones you know; later versions may add codes.
 */
export type CollectionDbErrorCode =
  | "too_large"
  | "truncated"
  | "bad_count"
  | "bad_marker"
  | "bad_length"
  | "invalid_utf8"
  | "trailing_bytes"
  | "invalid_version"
  | "invalid_name"
  | "name_too_long"
  | "invalid_hash"
  | (string & {});

export class CollectionDbError extends Error {
  readonly code: CollectionDbErrorCode;
  /** Byte offset in the file of the field that failed, for read errors; else null. */
  readonly offset: number | null;
  /** Index of the collection involved, when there is one. */
  readonly collection: number | null;
  /**
   * Position of the hash involved: its place in that collection's list in the file (null hashes
   * included), for read errors, or in the hashes you passed to addToCollection.
   */
  readonly hash: number | null;

  constructor(
    code: CollectionDbErrorCode,
    message: string,
    options: {
      offset?: number | null | undefined;
      collection?: number | null | undefined;
      hash?: number | null | undefined;
    } = {},
  ) {
    super(message);
    this.name = "CollectionDbError";
    this.code = code;
    this.offset = options.offset ?? null;
    this.collection = options.collection ?? null;
    this.hash = options.hash ?? null;
  }
}
