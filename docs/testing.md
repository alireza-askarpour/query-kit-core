# Testing Guide

## Current testing style

The project currently uses:

- `node:test`
- `assert/strict`
- tests executed against built output in `dist/`

## Why this approach

This keeps runtime verification close to the distributed package shape.

## Current test areas

- processor pipeline
- adapter registration
- TypeORM adapter behavior

## Recommended additions

- Sequelize adapter behavior coverage
- SC format parser edge cases
- SC validator rule-specific coverage
- Nest module wiring smoke tests

## Coverage goal

When refactoring infrastructure components:

- cover success path
- cover validation failures
- cover unsupported operator failures
- cover default runtime option behavior
