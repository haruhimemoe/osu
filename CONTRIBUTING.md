# Contributing

1. Read [AGENTS.md](./AGENTS.md), especially the `/shapes` split and "Public API is pinned".
2. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
3. Write a failing test in `tests/`, make it pass, keep commits small and Conventional.
4. Run `bun run check && bun run typecheck && bun run test && bun run test:dist`.
5. Add a line to `CHANGELOG.md` under `## [Unreleased]`, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (Added, Changed, Deprecated, Removed, Fixed, Security).
