# Changelog

All notable changes to `@haruhimemoe/osu`.

## 0.1.0 (unreleased)

- First release, extracted from packs.haruhime.moe's osu! client and schemas.
- `/shapes`: `BeatmapMeta` and osu!'s beatmap row with `toBeatmapMeta`; beatmapset content fields with `isExtendedBeatmapset`; `toOsuUser`; links and sign-in endpoints; `Ruleset`.
- `createOsuClient({ credentials, userAgent, baseUrl?, timeoutMs?, fetch?, now? })` with `getBeatmaps`, `getBeatmapsets` and `getStarRating`. The README lists every export.
- Every failure talking to osu! is an `OsuApiError` with a `code` (`timeout`, `network`, `bad_response`, `http_error`, `budget`), the HTTP `status` and, on a 429 or 503, `retryAfterMs`. Bad arguments throw `RangeError` and bad credentials `TypeError` before anything is sent.
- `baseUrl` must be https (or http on localhost), since it receives the client secret.
- All three methods take a `beforeCall` budget; rows osu! sends that fail the schema are `unchecked`, not `missing`.
- Compared with packs' client: the client reads no env, `getBeatmapsets` returns osu!'s extended sets instead of compliance facts, and `getBeatmaps` returns `{ found, missing, unchecked }`.
