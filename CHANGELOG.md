# Changelog

All notable changes to `@haruhimemoe/osu` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@haruhimemoe/osu/collections`, safe in browsers and free of zod: `readCollectionDb` and `writeCollectionDb` for osu!stable's `collection.db`. A file stable wrote round-trips byte for byte. The reader reports oddities as warnings and throws a `CollectionDbError` with a `code` and byte offset for a file it can't read. Both take a `maxBytes` limit (64 MiB by default).
- Helpers that never change their arguments: `createCollectionDb`, `normalizeHash`, `collectionHashesFor`, `addToCollection` (by exact name, no duplicate hashes, a `similarName` hint), `mergeCollections` (lazer's import rules), and `lazerImportFiles` (the two files lazer's setup wizard imports).
- The root entry point re-exports `/collections`. These are new public exports, so the next release is a minor version.

## [0.1.0] - 2026-09-23

### Added

- `@haruhimemoe/osu/shapes`, safe in browsers: `BeatmapMeta` and osu!'s beatmap row, beatmapset content fields, `toOsuUser`, osu! links and cover URLs, and the sign-in endpoints and scopes.
- `createOsuClient` for servers, with `getBeatmaps`, `getBeatmapsets` and `getStarRating`: a cached client-credentials token, a required User-Agent, timeouts, and a `beforeCall` hook for a shared rate budget.
- `OsuApiError` with a `code`, the HTTP `status` and `retryAfterMs`.

[unreleased]: https://github.com/haruhimemoe/osu/compare/f89f0042f1d6559740dd995e41a8a59d86c35a6a...HEAD
[0.1.0]: https://github.com/haruhimemoe/osu/tree/f89f0042f1d6559740dd995e41a8a59d86c35a6a
