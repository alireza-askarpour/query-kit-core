# Adapters

Adapters convert a `NormalizedFilter` into ORM-native output.

## Responsibilities

- map normalized operators into ORM expressions
- apply field selection
- apply sorting
- apply pagination
- apply includes or joins
- optionally render `CASE` expressions

## Current adapters

- `mongoose`
- `sequelize`
- `typeorm`

## Registration model

Adapters are registered through `AdapterRegistration` / `AdapterBundle`.

This allows future additions such as:

- capability discovery
- metadata-driven behavior
- adapter-specific configuration patterns

## Files

- `adapter-bundles.ts`: default adapter provider registration bundle
- `sequelize/`
- `typeorm/`
