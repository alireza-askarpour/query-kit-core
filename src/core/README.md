# Core

The `core` layer contains the package contracts, normalized types, registry, and processing pipeline.

## Responsibilities

- define reusable interfaces and types
- keep business flow independent from a specific format or ORM
- provide a central registry
- provide a single processor entry point

## Structure

```text
src/core/
  contracts/
  services/
  types/
  index.ts
```

## Main modules

- `contracts/`: extension interfaces
- `types/`: normalized filter model
- `services/filter-registry.service.ts`
- `services/filter-processor.service.ts`

## Key concepts

### `NormalizedFilter`

The shared internal representation between formats and adapters.

### `FilterRegistry`

Stores:

- formats
- format validators
- adapters
- adapter registrations

### `FilterProcessor`

Coordinates:

- runtime options
- validation
- parsing
- adapter conversion
