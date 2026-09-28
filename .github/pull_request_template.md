## Summary

<!-- What changed and why. Link the issue if there is one. -->

## Checklist

- [ ] `bun run check && bun run typecheck && bun run test:coverage && bun run test:dist`
- [ ] `bun run check:consumer 4.0.16`, if the zod peer range or the package's `exports` changed
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`
- [ ] `README.md` and `llms.txt` match, if an export, option, default or error changed
- [ ] `tests/exports.test.ts` and `tests/types.test.ts` updated, if an export was added or removed
