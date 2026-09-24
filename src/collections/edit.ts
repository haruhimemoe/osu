/**
 * @file src/collections/edit.ts
 * @desc Pure helpers for editing a CollectionDb: an empty database, hash normalizing, hashes for
 *       a list of difficulties, adding to a collection by exact name, merging a second file with
 *       lazer's import rules, and the two files lazer's setup wizard imports. None changes its
 *       arguments, so a call whose result is thrown away works as a preview. They apply our rules
 *       to new data only (lowercase hashes, no duplicates, sensible new names) and never remove or
 *       reorder what's already there.
 * @author David @dvhsh (https://dvh.sh)
 * @created Thu Sep 24, 2026
 * @modified Thu Sep 24, 2026
 */

import { CollectionDbError } from "./errors.js";
import {
  COLLECTION_DB_FILENAME,
  type CollectionDb,
  DEFAULT_COLLECTION_DB_VERSION,
  HEX_32,
  isInt32,
  MAX_COLLECTION_NAME_BYTES,
  type OsuCollection,
  utf8Length,
} from "./model.js";
import { writeCollectionDb } from "./write.js";

/**
 * Lazer takes a folder holding a file named osu!.*.cfg as a stable install. It only reads the cfg
 * named after the OS user, so this empty one does nothing but pass that check.
 */
const LAZER_IMPORT_CFG = "osu!.import.cfg";
const CONTROL_CHARACTER = /\p{Cc}/u;

// Appends hashes the list doesn't hold yet (exact match), in order.
const appendHashes = (existing: readonly string[], additions: Iterable<string>) => {
  const hashes = [...existing];
  const present = new Set(existing);
  let added = 0;
  let alreadyPresent = 0;
  for (const hash of additions) {
    if (present.has(hash)) {
      alreadyPresent++;
    } else {
      present.add(hash);
      hashes.push(hash);
      added++;
    }
  }
  return { hashes, added, alreadyPresent };
};

// Throws unless `name` is fit to be a new collection's name.
const checkNewName = (name: unknown): void => {
  const reason =
    typeof name !== "string"
      ? "must be a string"
      : name === ""
        ? "can't be empty"
        : name !== name.trim()
          ? "can't start or end with whitespace"
          : CONTROL_CHARACTER.test(name)
            ? "can't hold control characters"
            : utf8Length(name) < 0
              ? "can't hold lone surrogates"
              : null;
  if (reason !== null) {
    throw new CollectionDbError("invalid_name", `a new collection's name ${reason}`);
  }
  if (utf8Length(name as string) > MAX_COLLECTION_NAME_BYTES) {
    throw new CollectionDbError(
      "name_too_long",
      `a new collection's name can be at most ${MAX_COLLECTION_NAME_BYTES} UTF-8 bytes`,
    );
  }
};

// Names equal apart from case, outer whitespace and Unicode form compare equal here.
const looseName = (name: string): string => name.normalize("NFKC").trim().toLowerCase();

/**
 * @function createCollectionDb
 * @param version {number} the version to write, DEFAULT_COLLECTION_DB_VERSION (20150203) unless
 *        given; an integer from -2^31 to 2^31 - 1
 * @returns {CollectionDb} an empty database
 * @throws {CollectionDbError} invalid_version
 */
export const createCollectionDb = (
  version: number = DEFAULT_COLLECTION_DB_VERSION,
): CollectionDb => {
  if (!isInt32(version)) {
    throw new CollectionDbError(
      "invalid_version",
      "version must be an integer from -2^31 to 2^31 - 1",
    );
  }
  return { version, collections: [] };
};

/**
 * @function normalizeHash
 * @param value {string} a difficulty's MD5, in any case
 * @returns {string | null} the MD5 in lowercase, or null when it isn't exactly 32 hex characters
 *          (nothing is trimmed, and anything but a string is null)
 */
export const normalizeHash = (value: string): string | null =>
  typeof value === "string" && HEX_32.test(value) ? value.toLowerCase() : null;

/**
 * @function collectionHashesFor
 * @param beatmaps {Iterable<T>} difficulties with a `checksum`: BeatmapMeta, osu!'s beatmap rows,
 *        or your own objects carrying the MD5 of the .osu bytes you handed out
 * @returns {{ hashes: string[]; withoutChecksum: T[] }} the normalized hashes, deduplicated in
 *          input order, and the items whose checksum is null, missing or malformed
 */
export const collectionHashesFor = <T extends { checksum?: string | null | undefined }>(
  beatmaps: Iterable<T>,
): { hashes: string[]; withoutChecksum: T[] } => {
  const hashes: string[] = [];
  const seen = new Set<string>();
  const withoutChecksum: T[] = [];
  for (const beatmap of beatmaps) {
    const hash = normalizeHash(beatmap.checksum as string);
    if (hash === null) {
      withoutChecksum.push(beatmap);
    } else if (!seen.has(hash)) {
      seen.add(hash);
      hashes.push(hash);
    }
  }
  return { hashes, withoutChecksum };
};

/**
 * @function addToCollection
 * @param db {CollectionDb} the database, as read or built
 * @param name {string} the collection, matched exactly (case counts, nothing is trimmed); the first
 *        of duplicate names wins. A new name must be non-empty, have no outer whitespace, control
 *        characters or lone surrogates, and be at most MAX_COLLECTION_NAME_BYTES (127) UTF-8 bytes
 * @param hashes {Iterable<string>} MD5s to add; each must be 32 hex characters (any case)
 * @returns {{ db: CollectionDb; index: number; created: boolean; added: number;
 *          alreadyPresent: number; similarName: string | null }} a new database with the hashes
 *          appended (or the collection created at the end), where the collection is, how many
 *          hashes were added and how many were skipped because the collection already held them
 *          (repeats in `hashes` included), and, only when it created the collection, an existing
 *          name equal to `name` apart from case, outer whitespace or Unicode form
 * @throws {CollectionDbError} invalid_name or name_too_long for a bad new name, then invalid_hash
 *         with the hash's position in `hashes`
 */
export const addToCollection = (
  db: CollectionDb,
  name: string,
  hashes: Iterable<string>,
): {
  db: CollectionDb;
  index: number;
  created: boolean;
  added: number;
  alreadyPresent: number;
  similarName: string | null;
} => {
  const collections = [...db.collections];
  const found = collections.findIndex((collection) => collection.name === name);
  const created = found === -1;
  let similarName: string | null = null;
  if (created) {
    checkNewName(name);
    const wanted = looseName(name);
    similarName =
      collections.find((collection) => looseName(collection.name) === wanted)?.name ?? null;
  }

  const additions: string[] = [];
  let position = 0;
  for (const value of hashes) {
    const hash = normalizeHash(value);
    if (hash === null) {
      throw new CollectionDbError("invalid_hash", `hash ${position} isn't 32 hex characters`, {
        hash: position,
      });
    }
    additions.push(hash);
    position++;
  }

  const index = created ? collections.length : found;
  const existing = created ? [] : (collections[found] as OsuCollection).hashes;
  const result = appendHashes(existing, additions);
  collections[index] = { name, hashes: result.hashes };
  return {
    db: { version: db.version, collections },
    index,
    created,
    added: result.added,
    alreadyPresent: result.alreadyPresent,
    similarName,
  };
};

/**
 * @function mergeCollections
 * @param target {CollectionDb} the database to merge into; its version is kept
 * @param source {CollectionDb} another file, such as a shared collection pack
 * @returns {{ db: CollectionDb; created: number; added: number; alreadyPresent: number;
 *          invalid: number }} a new database where each source collection, in order, merged into
 *          the target collection with the same exact name or was created at the end (two
 *          same-named source collections land in one), and how many collections were created and
 *          how many source hashes were added, already there, or skipped as not 32 hex characters.
 *          These are lazer's import rules, except that no collection gets a duplicate hash.
 */
export const mergeCollections = (
  target: CollectionDb,
  source: CollectionDb,
): {
  db: CollectionDb;
  created: number;
  added: number;
  alreadyPresent: number;
  invalid: number;
} => {
  const collections = [...target.collections];
  const byName = new Map<string, number>();
  collections.forEach((collection, index) => {
    if (!byName.has(collection.name)) byName.set(collection.name, index);
  });
  let created = 0;
  let added = 0;
  let alreadyPresent = 0;
  let invalid = 0;

  for (const incoming of source.collections) {
    const valid: string[] = [];
    for (const value of incoming.hashes) {
      const hash = normalizeHash(value);
      if (hash === null) invalid++;
      else valid.push(hash);
    }
    let index = byName.get(incoming.name);
    if (index === undefined) {
      index = collections.length;
      byName.set(incoming.name, index);
      created++;
    }
    const result = appendHashes(collections[index]?.hashes ?? [], valid);
    collections[index] = { name: incoming.name, hashes: result.hashes };
    added += result.added;
    alreadyPresent += result.alreadyPresent;
  }

  return { db: { version: target.version, collections }, created, added, alreadyPresent, invalid };
};

/**
 * @function lazerImportFiles
 * @param db {CollectionDb} what to import into lazer, usually just the additions (lazer merges by
 *        exact name and never removes anything)
 * @returns {{ path: string; bytes: Uint8Array<ArrayBuffer> }[]} collection.db and an empty
 *          osu!.import.cfg, to zip at the root of an archive (not inside a folder) for lazer's
 *          setup wizard to import as a "previous osu! install"
 * @throws {CollectionDbError} whatever writeCollectionDb throws
 */
export const lazerImportFiles = (
  db: CollectionDb,
): { path: string; bytes: Uint8Array<ArrayBuffer> }[] => [
  { path: COLLECTION_DB_FILENAME, bytes: writeCollectionDb(db) },
  { path: LAZER_IMPORT_CFG, bytes: new Uint8Array(0) },
];
