# Packaging Guide

## Required files

For package publishing, the project should have:

- `package.json`
- `README.md`
- build output in `dist/`
- lint and format configuration

## Current package metadata

The package already defines:

- `main`
- `types`
- `exports`
- `files`
- `engines`
- publish-time scripts

## Recommended packaging workflow

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm test:coverage
pnpm publish
```

## Notes

- avoid publishing raw `src/` unless intentionally desired
- keep public API centralized through `src/index.ts`
- ensure `dist/` contains declaration files
- review `README.md` before each release
