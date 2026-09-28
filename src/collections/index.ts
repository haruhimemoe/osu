/**
 * @file src/collections/index.ts
 * @desc @haruhimemoe/osu/collections: read, edit and write osu!stable's collection.db, and build
 *       the files lazer's setup wizard imports. It lists its exports by name, so the helpers in
 *       model.ts and cursor.ts stay private. Uint8Array in and out, no I/O and no runtime
 *       imports from outside this folder, so it's safe in browsers.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Mon Sep 28, 2026
 */

export {
  type AddToCollectionResult,
  addToCollection,
  type CollectionHashes,
  collectionHashesFor,
  createCollectionDb,
  type LazerImportFile,
  lazerImportFiles,
  type MergeCollectionsResult,
  mergeCollections,
  normalizeHash,
} from "./edit.js";
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
export { type WriteCollectionDbOptions, writeCollectionDb } from "./write.js";
