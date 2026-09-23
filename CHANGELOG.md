# Changelog

All notable changes to `@haruhimemoe/osu`.

## 0.1.0 (unreleased)

- First release, extracted from packs.haruhime.moe's osu! client and schemas.
- `/shapes`: `BeatmapMeta` and osu!'s beatmap row with `toBeatmapMeta`; beatmapset content fields with `isExtendedBeatmapset`; `toOsuUser`; links and sign-in endpoints; `Ruleset`.
- `createOsuClient({ credentials, userAgent, baseUrl?, fetch?, now? })` with `getBeatmaps`, `getBeatmapsets` and `getStarRating`.
- Changes from packs' client:
  - `userAgent` is required and credentials are passed in; the client reads no env.
  - `getBeatmapsetFacts` is `getBeatmapsets`: it returns osu!'s extended sets, not compliance facts (use `@haruhimemoe/compliance`), and takes `fallbackLimit`.
  - `getStarRating` takes any mod acronyms.
  - The user mapping returns `{ osuId, username, avatarUrl, countryCode }`; the synthetic email packs gives better-auth stays in packs.
