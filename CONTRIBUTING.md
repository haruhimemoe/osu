# Contributing

1. Read [AGENTS.md](./AGENTS.md), especially "Keys are forever".
2. Branch from `main` (`feat/<topic>`, `fix/<topic>`).
3. Write a failing test in `tests/`, make it pass, keep commits small and Conventional.
4. Run `bun run check && bun run typecheck && bun run test && bun run test:dist`.
5. Add a line to `CHANGELOG.md` under the next version.
