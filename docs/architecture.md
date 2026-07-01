# Architecture Guide

## Design goals

The package is designed around:

- extensibility for future query syntaxes
- extensibility for future ORM adapters
- separation of concerns
- library-first usage
- NestJS compatibility without coupling the whole codebase to Nest

## Layers

### `core`

The `core` layer defines:

- contracts
- runtime pipeline
- registry
- neutral filter IR types

It does not know the implementation details of a specific query syntax or a specific ORM.

### `formats`

Each format is responsible for:

- parsing a query syntax
- optionally validating the syntax
- producing neutral filter IR

A format can have:

- parser service
- validator
- constants
- schema rules
- value parsing helpers

### `adapters`

Each adapter is responsible for:

- converting `FilterIR` into ORM-specific query output
- supporting the subset of operators that the ORM can express
- exposing a stable `ormName`

### `nest`

The Nest layer wires:

- formats
- validators
- adapters
- runtime options

This keeps Nest-specific registration outside the library core.

## Registries

### Format registration

Formats are registered as:

- `format`
- optional `validator`

This allows the processor to resolve validation and parsing using a consistent model.

### Adapter registration

Adapters are registered as bundles:

- `adapter`
- optional `capabilities`
- optional `metadata`

This supports future growth without changing the registry shape for every new ORM.

## Processing flow

1. A request enters `FilterProcessor`
2. The processor resolves the format
3. Validation runs if enabled
4. The format parses the query into a neutral IR structure
5. The processor resolves the adapter
6. The adapter converts the neutral IR structure into ORM-native output

## Open/closed principle

The current architecture tries to avoid changing core runtime behavior every time a new integration is added.

Expected future additions:

- new formats such as `RSQL`, `JSON`, `DSL`
- new adapters such as `Prisma`, `Mongoose`, `Knex`
- richer capability-driven decisions in the registry or processor
