# AGENTS.md

`@haruhimemoe/osu`: osu! API v2 shapes (`src/shapes/`, exported alone at `@haruhimemoe/osu/shapes`), a server client (`src/client.ts`), and a `collection.db` codec (`src/collections/`, exported alone at `@haruhimemoe/osu/collections`). ESM only, TypeScript, zod 4 as a peer dependency.

## Layout

- `src/index.ts`: the root entry. Re-exports the client, every shape, and `/collections`.
- `src/client.ts`: `createOsuClient` (`getBeatmaps`, `getBeatmapsets`, `getStarRating`), `OsuApiError`, the option and result types, and the `OSU_BEATMAPS_BATCH_LIMIT`, `BEATMAPSET_FALLBACK_LIMIT` and `OSU_TIMEOUT_MS` constants.
- `src/shapes/index.ts`: the `/shapes` entry.
- `src/shapes/beatmap.ts`: rulesets, `BeatmapMeta`, osu!'s `/beatmaps` row, and `toBeatmapMeta`.
- `src/shapes/beatmapset.ts`: a beatmapset's content fields, `OsuBeatmapsetExtended`, `isExtendedBeatmapset`, and the row-to-set schema.
- `src/shapes/user.ts`: the `/me` schema and `toOsuUser`.
- `src/shapes/links.ts`: `OSU_BASE_URL`, the OAuth endpoints and sign-in scopes, and page and cover URLs.
- `src/collections/index.ts`: the `/collections` entry. It lists its exports by name, so the internals in `model.ts` stay private.
- `src/collections/model.ts`: `OsuCollection`, `CollectionDb`, the limits and constants, and the checks the other files share (the MD5 patterns, int32, UTF-8 length with lone-surrogate detection, the `maxBytes` option).
- `src/collections/read.ts`: `readCollectionDb` and the warning types. `src/collections/write.ts`: `writeCollectionDb`.
- `src/collections/edit.ts`: `createCollectionDb`, `normalizeHash`, `collectionHashesFor`, `addToCollection`, `mergeCollections`, `lazerImportFiles`.
- `src/collections/errors.ts`: `CollectionDbError` and its codes.
- `tests/`: Vitest. `tests/exports.test.ts` pins the public API; `tests/fixtures/beatmaps.json` is hand-written in osu!'s shape. `tests/collection-vectors.ts` holds the hand-built `collection.db` byte vectors, as hex.
- `scripts/smoke.mjs`: imports the built `dist/` the way apps will (`bun run test:dist`). It runs `/collections` with Node's `Buffer` removed.
- `scripts/check-consumer.mjs`: packs the package, installs it with a given zod version, then typechecks (DOM lib, no Node types) and runs a strict consumer of every entry point (`bun run check:consumer <zod version>`, needs the npm registry).
- `.github/workflows/ci.yml`: Biome, typecheck, tests with coverage, and a pack dry run; the dist smoke test on Node 22.12 and 24; the consumer check on zod 4.0.16 and latest.
- `.github/workflows/release.yml`: publishes to npm when a GitHub release is published. Maintainers only.
- `llms.txt`: the repo summary for LLMs. It isn't shipped in the npm package.

## Rules

- **`src/shapes/` never imports `src/client.ts`** or anything that holds secrets or does I/O. Browsers and `@haruhimemoe/hinai` import `/shapes`; `tests/exports.test.ts` and `scripts/smoke.mjs` check the split.
- **`src/collections/` imports nothing at runtime from outside itself**: not the client, not `/shapes`, not zod. `import type` is fine (it's erased), but `import { type X }` still loads the module under `verbatimModuleSyntax`, so use `import type`. It's browser code: `Uint8Array` in and out, only `TextEncoder`, `TextDecoder` and `DataView`, no `Buffer`, `fs` or other Node APIs. `tests/exports.test.ts` scans the folder for this, and `scripts/smoke.mjs` runs it without `Buffer`.
- **The collections codec is faithful; the helpers are strict.** The reader keeps everything it finds and reports oddities as warnings, and the writer writes what it's given, so a stable-written file round-trips byte for byte. Our rules (lowercase hashes, no duplicates, new-name checks) apply only to new data, in `edit.ts`. Nothing changes its arguments. Build test bytes from hex in `tests/collection-vectors.ts`: `.editorconfig` would mangle a binary fixture, and no third-party `collection.db` (lazer's fixture included) goes in the repo.
- **Collection errors never carry a name or hash.** Messages and fields hold byte offsets and indexes only, since names can be personal.
- **Shapes follow osu!'s API.** Field names are osu!'s snake_case in `osu*Schema` and our camelCase only in mapped types (`BeatmapMeta`, `OsuUser`). Schemas strip unknown keys. A mapping never guesses an identity.
- **The client stays generic.** No env reading, no database, no cache, no app wording. Apps pass credentials, a User-Agent, and a `beforeCall` budget. A feature that needs storage belongs in the app.
- **Respect osu!'s terms:** a real User-Agent on every request, one token per client, and no retry loops beyond the single 401 refresh.
- **Tests never call osu!.** Stub requests with msw or the client's `fetch` option. Fixtures are hand-written in osu!'s shape.
- **zod is a peer dependency** (^4.0.16). Don't add runtime dependencies. Dev dependencies use exact versions.
- **Public API is pinned** by `tests/exports.test.ts`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- **Docs match the code.** When an export, option, default or error changes, update `README.md` (it's for users) and `llms.txt` in the same change. Add a line under `## [Unreleased]` in `CHANGELOG.md` ([Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)); never edit a released entry.
- **Releases are cut by the maintainers.** Don't bump the version, tag, or publish.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every `.ts` and `.mjs` file starts with the `@file / @desc / @author / @created / @modified` header; set `@modified` on files you change. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.
- Coverage stays at 95% or more for lines, functions, branches and statements (`vitest.config.ts`).

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
```

If the change touches the zod peer range or the package's `exports`, also run `bun run check:consumer 4.0.16`.
