/**
 * @file tests/exports.test.ts
 * @desc The public surface of every entry point, so an accidental export or removal shows up in
 *       review as a semver question; /shapes never grows client code, /collections stays a
 *       browser-safe codec that imports nothing at runtime from outside src/collections/, and
 *       /format holds only formatters that import nothing. Type exports are pinned in
 *       tests/types.test.ts.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Mon Sep 28, 2026
 */

import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as collections from "../src/collections/index.js";
import * as format from "../src/format/index.js";
import * as api from "../src/index.js";
import * as shapes from "../src/shapes/index.js";

it("exports the documented runtime API", () => {
  expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
    [
      "BEATMAPSET_FALLBACK_LIMIT",
      "COLLECTION_DB_FILENAME",
      "CollectionDbError",
      "DEFAULT_COLLECTION_DB_VERSION",
      "MAX_COLLECTION_DB_BYTES",
      "MAX_COLLECTION_NAME_BYTES",
      "OSU_BASE_URL",
      "OSU_BEATMAPSET_FALLBACK_LIMIT",
      "OSU_BEATMAPS_BATCH_LIMIT",
      "OSU_OAUTH",
      "OSU_SIGN_IN_SCOPES",
      "OSU_TIMEOUT_MS",
      "OsuApiError",
      "RULESETS",
      "addToCollection",
      "beatmapMetaSchema",
      "beatmapUrl",
      "beatmapsetUrl",
      "collectionHashesFor",
      "coverUrl",
      "createCollectionDb",
      "createOsuClient",
      "formatBpm",
      "formatBytes",
      "formatDuration",
      "formatLongDuration",
      "formatRange",
      "formatStars",
      "formatStat",
      "isExtendedBeatmapset",
      "lazerImportFiles",
      "mergeCollections",
      "normalizeHash",
      "osuBeatmapRowSchema",
      "osuBeatmapsetRowSchema",
      "osuBeatmapsetSchema",
      "osuUserSchema",
      "readCollectionDb",
      "rulesetSchema",
      "toBeatmapMeta",
      "toOsuUser",
      "userUrl",
      "writeCollectionDb",
    ]
  `);
});

it("keeps the client out of /shapes", () => {
  expect(Object.keys(shapes)).not.toContain("createOsuClient");
  expect(
    Object.keys(api)
      .filter((name) => !(name in shapes) && !(name in collections) && !(name in format))
      .sort(),
  ).toEqual([
    "BEATMAPSET_FALLBACK_LIMIT",
    "OSU_BEATMAPSET_FALLBACK_LIMIT",
    "OSU_BEATMAPS_BATCH_LIMIT",
    "OSU_TIMEOUT_MS",
    "OsuApiError",
    "createOsuClient",
  ]);
});

it("keeps the deprecated BEATMAPSET_FALLBACK_LIMIT equal to its prefixed name", () => {
  expect(api.BEATMAPSET_FALLBACK_LIMIT).toBe(api.OSU_BEATMAPSET_FALLBACK_LIMIT);
  expect(api.OSU_BEATMAPSET_FALLBACK_LIMIT).toBe(10);
});

it("keeps /collections to the collection.db API: no client, no shapes", () => {
  expect(Object.keys(collections).sort()).toEqual([
    "COLLECTION_DB_FILENAME",
    "CollectionDbError",
    "DEFAULT_COLLECTION_DB_VERSION",
    "MAX_COLLECTION_DB_BYTES",
    "MAX_COLLECTION_NAME_BYTES",
    "addToCollection",
    "collectionHashesFor",
    "createCollectionDb",
    "lazerImportFiles",
    "mergeCollections",
    "normalizeHash",
    "readCollectionDb",
    "writeCollectionDb",
  ]);
  expect(Object.keys(collections)).not.toContain("createOsuClient");
  expect(Object.keys(collections).filter((name) => name in shapes)).toEqual([]);
});

/**
 * Scans a folder that must stay browser code: each file may load only its siblings at runtime,
 * with no side-effect imports and no Node APIs. Returns each file's runtime imports.
 */
const scanBrowserFolder = (path: string): Map<string, string[]> => {
  const folder = new URL(path, import.meta.url);
  const runtimeImports = new Map<string, string[]>();
  for (const file of readdirSync(folder).sort()) {
    // Comments may mention anything; only code counts.
    const code = readFileSync(new URL(file, folder), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    const froms: string[] = [];
    for (const [, clause, from] of code.matchAll(
      /^(?:import|export)\b([^;]*?)\bfrom\s+"([^"]+)";/gm,
    )) {
      // `import type` is erased from the build; everything else loads the module.
      if (!clause?.trim().startsWith("type ")) froms.push(from as string);
    }
    runtimeImports.set(file, froms);
    for (const from of froms) expect(from, `${file} imports ${from}`).toMatch(/^\.\/[a-z]+\.js$/);
    expect(code, `${file} has a side-effect import`).not.toMatch(/^import\s+"/m);
    expect(code, `${file} uses a Node API or loads code`).not.toMatch(
      /\bimport\s*\(|\brequire\s*\(|\bBuffer\b|\bprocess\b|node:/,
    );
  }
  return runtimeImports;
};

it("keeps src/collections/ free of outside runtime imports and of Node APIs", () => {
  const runtimeImports = scanBrowserFolder("../src/collections/");
  expect([...runtimeImports.keys()]).toEqual([
    "cursor.ts",
    "edit.ts",
    "errors.ts",
    "index.ts",
    "model.ts",
    "read.ts",
    "write.ts",
  ]);
  // The scan sees the entry's re-exports, so it isn't passing by reading nothing.
  expect(runtimeImports.get("index.ts")?.sort()).toEqual([
    "./edit.js",
    "./errors.js",
    "./model.js",
    "./read.js",
    "./write.js",
  ]);
});

it("keeps /format to formatters that import nothing", () => {
  expect(Object.keys(format).sort()).toEqual([
    "formatBpm",
    "formatBytes",
    "formatDuration",
    "formatLongDuration",
    "formatRange",
    "formatStars",
    "formatStat",
  ]);
  expect(Object.keys(format).filter((name) => name in shapes || name in collections)).toEqual([]);
  expect(scanBrowserFolder("../src/format/")).toEqual(new Map([["index.ts", []]]));
});
