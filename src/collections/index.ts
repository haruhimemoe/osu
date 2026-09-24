/**
 * @file src/collections/index.ts
 * @desc @haruhimemoe/osu/collections: read and write osu!stable's collection.db. Uint8Array in and
 *       out, no I/O and no runtime imports from outside this folder, so it's safe in browsers.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

export { CollectionDbError, type CollectionDbErrorCode } from "./errors.js";
export {
  COLLECTION_DB_FILENAME,
  type CollectionDb,
  DEFAULT_COLLECTION_DB_VERSION,
  MAX_COLLECTION_DB_BYTES,
  MAX_COLLECTION_NAME_BYTES,
  type OsuCollection,
} from "./model.js";
export {
  type CollectionDbRead,
  type CollectionDbWarning,
  type CollectionDbWarningCode,
  type ReadCollectionDbOptions,
  readCollectionDb,
} from "./read.js";
export { writeCollectionDb } from "./write.js";
