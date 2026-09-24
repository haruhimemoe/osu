# Contributing

Bugs and ideas go in [issues](https://github.com/haruhimemoe/osu/issues). Report security problems privately, as [SECURITY.md](./SECURITY.md) says, not in an issue.

## Setup

You need [Bun](https://bun.sh) 1.4.2 (the `packageManager` in `package.json`) and Node 22.12 or later (CI uses the version in `.nvmrc`).

```sh
bun install
```

Read [AGENTS.md](./AGENTS.md) first, especially the `/shapes` split and "Public API is pinned".

## Making a change

1. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
2. Write a failing test in `tests/`, make it pass, and keep commits small and [Conventional](https://www.conventionalcommits.org/en/v1.0.0/). Tests never call osu!: stub requests with msw (or the client's `fetch` option), using the fixtures in `tests/fixtures/` (or add one, in osu!'s own shape).
3. Run the checks. CI runs the same ones.

   ```sh
   bun run check && bun run typecheck && bun run test:coverage && bun run test:dist
   ```

   `bun run check:fix` applies Biome's fixes and formatting. Coverage must stay at 95% or more. If your change touches the zod peer range, also run `bun run check:consumer 4.0.16` (needs the npm registry).
4. Add a line to `CHANGELOG.md` under `## [Unreleased]`, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (Added, Changed, Deprecated, Removed, Fixed, Security). Adding or removing a public export is a semver decision, so call it out.
5. If you changed an export, option, default or error, update `README.md` and `llms.txt` to match.
6. Open a pull request against `main`.

Releases are cut by the maintainers.
