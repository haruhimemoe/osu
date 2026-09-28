# Changelog

All notable changes to `@haruhimemoe/osu` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-28

### Added

- `getUser(user, { beforeCall, ruleset })` on the client: one user by id (`/api/v2/users/{id}?key=id`) or username (`/api/v2/users/@{name}`), with an optional ruleset, as an `OsuUser`, or null on 404. It rejects with code `"budget"` when `beforeCall` refuses, like `getStarRating`. pools and bb each had their own token and fetch for this.
- `getUsers(ids, { beforeCall })`: users by id, 50 per `/api/v2/users?ids[]=` call, as `{ found, missing, unchecked }` like `getBeatmaps`.
- The types `UserOptions`, `UsersOptions` and `UserLookup`. These are new public exports, so this release is a minor version.

## [0.3.0] - 2026-09-28

### Added

- `@haruhimemoe/osu/format`, safe in browsers and free of imports: `formatDuration` (`m:ss`), `formatLongDuration` (`h:mm:ss` from an hour up), `formatStars` (two decimals), `formatBpm`, `formatStat` (CS/AR/OD/HP), `formatBytes` and `formatRange`. packs and pools each had the same copy; the text is unchanged. The root entry point re-exports them. These are new public exports, so this release is a minor version.
- `OSU_BEATMAPSET_FALLBACK_LIMIT`, the default `fallbackLimit` (10), named like the client's other constants.
- Named types for what the collection helpers take and return: `WriteCollectionDbOptions`, `CollectionHashes`, `AddToCollectionResult`, `MergeCollectionsResult` and `LazerImportFile`. The shapes are unchanged.

### Changed

- `createOsuClient` refuses a `userAgent` that isn't printable ASCII with a `TypeError`. Before, a character past U+00FF (an emoji, say) passed, then every request failed with code `"network"`, and characters from U+0080 to U+00FF went out as raw Latin-1 bytes.
- Every exported class, function, type and schema has a doc comment, so editors show it on hover. `OsuApiError` and `CollectionDbError` document their constructors.

### Deprecated

- `BEATMAPSET_FALLBACK_LIMIT`: use `OSU_BEATMAPSET_FALLBACK_LIMIT`. It stays exported, with the same value, until a major release.

### Fixed

- Calls that got a 401 at the same time each dropped the token another call had just fetched and asked for another, so a revoked token could cost many token requests. They now share one refresh.
- A token that osu! issues for a minute or less is reused for half its life instead of being fetched again on every call.
- `mergeCollections` throws a `TypeError` for a source collection whose `name` isn't a string, as its docs said. It used to create a collection named `undefined` (or `5`), and the error only came later, from `writeCollectionDb`.
- `retryAfterMs` reads `Retry-After` only as delta-seconds or an HTTP date, like `@haruhimemoe/hinai`. A malformed value such as `1.5` or `-5` gave 0 ms ("retry now"); it now gives null.

### Security

- The release workflow runs every action from a pinned commit SHA and installs an exact npm version, since that job can publish with provenance. A release whose version is already on npm now ends with a warning instead of a quiet success. SECURITY.md lists GitHub private vulnerability reporting as the first channel.

## [0.2.0] - 2026-09-24

### Added

- `@haruhimemoe/osu/collections`, safe in browsers and free of zod: `readCollectionDb` and `writeCollectionDb` for osu!stable's `collection.db`. A file stable wrote round-trips byte for byte. The reader reports oddities as warnings and throws a `CollectionDbError` with a `code` and byte offset for a file it can't read. Both take a `maxBytes` limit (64 MiB by default). The reader also caps collections plus hashes at `maxBytes / 34` and lists at most 1,000 warnings (`omittedWarnings` counts the rest), so a crafted file can't run a page out of memory.
- Helpers that never change their arguments: `createCollectionDb`, `normalizeHash`, `collectionHashesFor`, `addToCollection` (by exact name, no duplicate hashes, a `similarName` hint), `mergeCollections` (lazer's import rules), and `lazerImportFiles` (the two files lazer's setup wizard imports).
- The root entry point re-exports `/collections`. These are new public exports, so this release is a minor version.

### Changed

- Typechecking `@haruhimemoe/osu` (the root entry point) now needs TypeScript 5.7 or later, or `skipLibCheck`, because it re-exports `/collections`, whose types use `Uint8Array<ArrayBuffer>`. This holds even for code that only imports `createOsuClient`. `@haruhimemoe/osu/shapes` alone still typechecks on older TypeScript.

## [0.1.0] - 2026-09-23

### Added

- `@haruhimemoe/osu/shapes`, safe in browsers: `BeatmapMeta` and osu!'s beatmap row, beatmapset content fields, `toOsuUser`, osu! links and cover URLs, and the sign-in endpoints and scopes.
- `createOsuClient` for servers, with `getBeatmaps`, `getBeatmapsets` and `getStarRating`: a cached client-credentials token, a required User-Agent, timeouts, and a `beforeCall` hook for a shared rate budget.
- `OsuApiError` with a `code`, the HTTP `status` and `retryAfterMs`.

[unreleased]: https://github.com/haruhimemoe/osu/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/haruhimemoe/osu/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/haruhimemoe/osu/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/haruhimemoe/osu/compare/f89f0042f1d6559740dd995e41a8a59d86c35a6a...v0.2.0
[0.1.0]: https://github.com/haruhimemoe/osu/tree/f89f0042f1d6559740dd995e41a8a59d86c35a6a
