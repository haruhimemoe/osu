/**
 * @file tests/collection-vectors.ts
 * @desc Hand-built collection.db byte vectors and small helpers for the collections tests. The
 *       vectors are written as hex here, never kept as binary fixtures: .editorconfig rewrites
 *       line endings and trailing whitespace in every file. Placeholder hashes are well-known MD5s
 *       (RFC 1321's test inputs) that no beatmap has.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

/**
 * @function hex
 * @param text {string} hex byte pairs; spaces and line breaks are ignored
 * @returns {Uint8Array<ArrayBuffer>} the bytes
 */
export const hex = (text: string): Uint8Array<ArrayBuffer> => {
  const clean = text.replace(/\s+/g, "");
  if (!/^(?:[0-9a-f]{2})*$/i.test(clean)) throw new Error("hex(): not hex byte pairs");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * @function asciiHex
 * @param text {string} ASCII text
 * @returns {string} its bytes as spaced hex, to splice into a vector
 */
export const asciiHex = (text: string): string =>
  Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");

/**
 * @function toHex
 * @param bytes {Uint8Array} any bytes
 * @returns {string} spaced lowercase hex, for readable failures
 */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");

/** MD5 of "" and of "a", "abc" and "message digest" (RFC 1321). */
export const MD5_EMPTY = "d41d8cd98f00b204e9800998ecf8427e";
export const MD5_A = "0cc175b9c0f1b6a831c399e269772661";
export const MD5_ABC = "900150983cd24fb0d6963f7d28e17f72";
export const MD5_DIGEST = "f96b697d7cb7938d525a2f31aaf161d0";

/** TV1: version 20150203, no collections (8 bytes). */
export const TV1_EMPTY = "bb 77 33 01  00 00 00 00";

/** TV2: version 20210520, one collection "Farm" holding MD5_EMPTY then MD5_A (86 bytes). */
export const TV2_FARM = `
  58 63 34 01  01 00 00 00
  0b 04 46 61 72 6d
  02 00 00 00
  0b 20 64 34 31 64 38 63 64 39 38 66 30 30 62 32 30 34 65 39 38 30 30 39 39 38 65 63 66 38 34 32 37 65
  0b 20 30 63 63 31 37 35 62 39 63 30 66 31 62 36 61 38 33 31 63 33 39 39 65 32 36 39 37 37 32 36 36 31
`;

/** TV3: "練習" (6 UTF-8 bytes) holding MD5_A, then an empty-named, empty collection (60 bytes). */
export const TV3_UNICODE_AND_EMPTY = `
  bb 77 33 01  02 00 00 00
  0b 06 e7 b7 b4 e7 bf 92
  01 00 00 00
  0b 20 30 63 63 31 37 35 62 39 63 30 66 31 62 36 61 38 33 31 63 33 39 39 65 32 36 39 37 37 32 36 36 31
  0b 00
  00 00 00 00
`;

/** TV4: one empty collection whose name is 200 × "a", so its length is the two bytes c8 01 (215 bytes). */
export const TV4_LONG_NAME = `bb 77 33 01  01 00 00 00  0b c8 01 ${"61 ".repeat(200)} 00 00 00 00`;

/** TV5: one collection with the null name marker and no hashes (13 bytes). */
export const TV5_NULL_NAME = "bb 77 33 01  01 00 00 00  00  00 00 00 00";

/** TV6: one collection whose name marker is 0x0c, followed by the string "hi" (16 bytes). */
export const TV6_BAD_MARKER = "bb 77 33 01  01 00 00 00  0c 02 68 69  00 00 00 00";

/** TV7: claims 2 collections but holds only "A" with no hashes (15 bytes). */
export const TV7_SHORT = "bb 77 33 01  02 00 00 00  0b 01 41  00 00 00 00";
