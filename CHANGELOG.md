# Changelog

All notable changes to `@haruhimemoe/osu` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-23

### Added

- `@haruhimemoe/osu/shapes`, safe in browsers: `BeatmapMeta` and osu!'s beatmap row, beatmapset content fields, `toOsuUser`, osu! links and cover URLs, and the sign-in endpoints and scopes.
- `createOsuClient` for servers, with `getBeatmaps`, `getBeatmapsets` and `getStarRating`: a cached client-credentials token, a required User-Agent, timeouts, and a `beforeCall` hook for a shared rate budget.
- `OsuApiError` with a `code`, the HTTP `status` and `retryAfterMs`.

[unreleased]: https://github.com/haruhimemoe/osu/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/haruhimemoe/osu/releases/tag/v0.1.0
