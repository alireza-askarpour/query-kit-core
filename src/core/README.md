# Core

The `core` layer contains the package contracts, neutral IR types, registry, and processing pipeline.

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
- `types/`: neutral filter IR and compatibility types
- `services/filter-registry.service.ts`
- `services/filter-processor.service.ts`

## Key concepts

### `FilterIR`

The shared neutral internal representation between formats and adapters.

Backend-specific concerns should flow through `extensions` instead of being promoted into the neutral IR surface by default.

### `NormalizedFilter`

Backward-compatible alias shape for older adapters and consumers during the IR transition.

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
