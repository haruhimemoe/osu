# AGENTS.md

`@haruhimemoe/osu`: osu! API v2 shapes (`src/shapes/`, exported alone at `@haruhimemoe/osu/shapes`) and a server client (`src/client.ts`).

## Rules

- **`src/shapes/` never imports `src/client.ts`** or anything that holds secrets or does I/O. Browsers and the hinai package import `/shapes`; `tests/exports.test.ts` checks the split.
- **Shapes follow osu!'s API.** Field names are osu!'s snake_case in `osu*Schema` and our camelCase only in mapped types (`BeatmapMeta`, `OsuUser`). Schemas strip unknown keys. A mapping never guesses an identity.
- **The client stays generic.** No env reading, no database, no cache, no app wording. Apps pass credentials, a User-Agent, and a `beforeCall` budget. A feature that needs storage belongs in the app.
- **Respect osu!'s terms:** a real User-Agent on every request, one token per client, and no retry loops beyond the single 401 refresh.
- **Tests never call osu!.** msw stubs every request; fixtures are hand-written in osu!'s shape.
- **zod is a peer dependency** (^4.0.16). Don't add runtime dependencies.
- **Public API is pinned** by `tests/exports.test.ts`. Adding or removing an export is a semver decision: note it in `CHANGELOG.md`.
- Code style: Biome (2 spaces, double quotes, 100 columns). Every file starts with the `@file / @desc / @author / @created / @modified` header. Exported functions get JSDoc with `@function`, `@param`, `@returns`. Imports in `src/` use `.js` extensions.

## Before calling a change done

```sh
bun run check && bun run typecheck && bun run test && bun run test:dist
```
