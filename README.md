# query-request

Extensible query filter parsing, validation, and ORM adapter pipeline for NestJS applications.

## Overview

`query-request` is a library-oriented package for turning query-string filters into a neutral filter IR and then converting that IR into ORM-specific query shapes.

The project is built around three concepts:

- `formats`: parse and optionally validate a query syntax
- `core`: orchestrate parsing, validation, registry lookup, and adapter execution
- `adapters`: convert neutral filter IR into ORM-native query representations

## Current capabilities

- Built-in `SC` format using `field:operator:value`
- Built-in `MC` format using `field:$operator:value`
- Neutral IR with logical groups and aggregation metadata
- Built-in `SC` format validator
- Built-in `MC` format validator
- Built-in adapter for `Mongoose`
- Built-in adapters for `Sequelize` and `TypeORM`
- Central `FilterProcessor` pipeline
- Registry-based extension model for formats, validators, and adapters
- Adapter bundle registration model for scalable ORM support

## Project structure

```text
src/
  adapters/
    adapter-bundles.ts
    sequelize/
    mongoose/
    typeorm/
  core/
    contracts/
    services/
    types/
  formats/
    mc/
    sc/
  nest/
  index.ts

docs/
```

More detailed documentation:

- [Architecture](docs/README.md)
- [SQL Dialect Support](docs/sql-dialect-support.md)
- [Core](src/core/README.md)
- [Formats](src/formats/README.md)
- [SC Format](src/formats/sc/README.md)
- [MC Format](src/formats/mc/README.md)
- [Mongoose Adapter](src/adapters/mongoose/README.md)
- [Adapters](src/adapters/README.md)
- [Sequelize Adapter](src/adapters/sequelize/README.md)
- [TypeORM Adapter](src/adapters/typeorm/README.md)
- [Nest Integration](src/nest/README.md)

## Installation

```bash
pnpm add query-request
```

## Quick example

```ts
import { FilterProcessor, FilterRegistry, SCFormat, SequelizeAdapter } from 'query-request';

const registry = new FilterRegistry();
registry.registerFormat(new SCFormat());
registry.registerAdapter(new SequelizeAdapter());

const processor = new FilterProcessor(registry, {
  defaultFormat: 'scfilter',
  defaultOrm: 'sequelize',
});

const result = processor.processWith({
  query: 'status:eq:active;price:between:100,200;@limit:20',
  adapterOptions: {
    model: ProductModel,
    rootAlias: 'product',
  },
});
```

## Aggregation example

```ts
const result = processor.processWith({
  query: 'status:eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount,avg(score):avgScore',
  adapterOptions: {
    model: ProductModel,
    rootAlias: 'product',
  },
});
```

Supported aggregation directives in built-in formats:

- `@groupBy:status,category`
- `@aggregate:count(*):total`
- `@aggregate:sum(amount):totalAmount,avg(score):avgScore`
- `@having:totalAmount:gte:100`

## Main public APIs

- `FilterProcessor`
- `FilterRegistry`
- `SCFormat`
- `MCFormat`
- `SCFormatValidator`
- `MCFormatValidator`
- `MongooseAdapter`
- `SequelizeAdapter`
- `TypeOrmAdapter`
- `FilterModule`

## Supported operators

Current normalized operators:

- `eq`, `neq`
- `gt`, `gte`, `lt`, `lte`
- `between`
- `like`, `iLike`, `notLike`
- `contains`, `startsWith`, `endsWith`
- `regex`
- `in`, `notIn`
- `any`, `all`, `size`
- `isNull`, `isNotNull`
- `exists`, `notExists`
- `date`, `year`, `month`, `day`
- `elemMatch`

## Development scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm lint:fix`
- `pnpm format`
- `pnpm format:check`
- `pnpm test`
- `pnpm test:coverage`

## Publishing checklist

1. Run `pnpm build`
2. Run `pnpm lint`
3. Run `pnpm test`
4. Run `pnpm test:coverage`
5. Verify `README.md` and `package.json`
6. Publish the package

## Extension model

This package is designed to be open for extension and closed for modification as much as practical:

- Add new query syntaxes by creating new format implementations
- Add new validation rules by attaching validators to formats
- Add new ORM integrations by implementing new adapters and registering adapter bundles

For extension guides, see:

- [Format extension guide](docs/format-extension.md)
- [Adapter extension guide](docs/adapter-extension.md)
- [Package architecture guide](docs/architecture.md)
