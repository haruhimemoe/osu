/**
 * @file tests/exports.test.ts
 * @desc The public surface of every entry point, so an accidental export or removal shows up in
 *       review as a semver question; /shapes never grows client code, and /collections stays a
 *       browser-safe codec that imports nothing at runtime from outside src/collections/.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Thu Sep 24, 2026
 */

import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as collections from "../src/collections/index.js";
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
      .filter((name) => !(name in shapes) && !(name in collections))
      .sort(),
  ).toEqual([
    "BEATMAPSET_FALLBACK_LIMIT",
    "OSU_BEATMAPS_BATCH_LIMIT",
    "OSU_TIMEOUT_MS",
    "OsuApiError",
    "createOsuClient",
  ]);
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

it("keeps src/collections/ free of outside runtime imports and of Node APIs", () => {
  const folder = new URL("../src/collections/", import.meta.url);
  const files = readdirSync(folder).sort();
  expect(files).toEqual(["edit.ts", "errors.ts", "index.ts", "model.ts", "read.ts", "write.ts"]);
  const runtimeImports = new Map<string, string[]>();
  for (const file of files) {
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
  // The scan sees the entry's re-exports, so it isn't passing by reading nothing.
  expect(runtimeImports.get("index.ts")?.sort()).toEqual([
    "./edit.js",
    "./errors.js",
    "./model.js",
    "./read.js",
    "./write.js",
  ]);
});
