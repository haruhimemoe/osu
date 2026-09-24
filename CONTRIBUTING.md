# Contributing

1. `bun install`. Read [AGENTS.md](./AGENTS.md), especially the `/shapes` split and "Public API is pinned".
2. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
3. Write a failing test in `tests/`, make it pass, keep commits small and Conventional. Tests never call osu!: stub requests with msw, using the fixtures in `tests/fixtures/` (or add one, in osu!'s own shape).
4. Run `bun run check && bun run typecheck && bun run test && bun run test:dist`. If your change touches the zod peer range, also run `bun run check:consumer 4.0.16` (needs the npm registry).
5. Add a line to `CHANGELOG.md` under `## [Unreleased]`, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (Added, Changed, Deprecated, Removed, Fixed, Security). Adding or removing a public export is a semver decision, call it out.

Releases are cut by the maintainers.
