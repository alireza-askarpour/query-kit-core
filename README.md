![query-kit-core banner](./assets/query-kit-core-banner.png)

# query-kit-core

`query-kit-core` is the server-side package in the Query Kit family.

It accepts filter payloads and query strings, parses them, validates them,
normalizes them into a neutral filter IR, and converts that IR into ORM-native
query structures for:

- `Sequelize`
- `Mongoose`
- `TypeORM`

This package is for backend/runtime use. A separate frontend package can build
payloads and query strings, but this package is the one that parses and applies
them.

---

## Table of contents

- [What this package does](#what-this-package-does)
- [Installation](#installation)
- [Quick start](#quick-start)
- [NestJS setup](#nestjs-setup)
- [Manual setup without NestJS](#manual-setup-without-nestjs)
- [Core concepts](#core-concepts)
- [Main processing API](#main-processing-api)
- [Query object shape](#query-object-shape)
- [Built-in formats](#built-in-formats)
- [SC format reference](#sc-format-reference)
- [MC format reference](#mc-format-reference)
- [Directives](#directives)
- [Operator reference](#operator-reference)
- [Validation](#validation)
- [Policy layer](#policy-layer)
- [Relations and include/populate](#relations-and-includepopulate)
- [Aggregation](#aggregation)
- [CASE expressions](#case-expressions)
- [Adapter reference](#adapter-reference)
- [Audit mode](#audit-mode)
- [Custom operators and extension points](#custom-operators-and-extension-points)
- [Public exports](#public-exports)
- [Limitations and compatibility notes](#limitations-and-compatibility-notes)
- [Troubleshooting](#troubleshooting)

---

## What this package does

`query-kit-core` solves the backend half of filter/query handling:

1. Accept a filter string or structured query object.
2. Parse one of the built-in formats:
   - `scfilter`
   - `mcfilter`
3. Optionally validate it against:
   - field schemas
   - operator rules
   - value constraints
   - role-based access rules
   - runtime policies
4. Convert it into a neutral filter IR.
5. Convert the IR into an ORM-native query structure.

Built-in feature coverage:

- `SC` format (`field:operator:value`)
- `MC` format (`field:$operator:value`)
- logical expressions in `SC`
- field selection
- sorting
- pagination
- relation loading
- aggregation
- `HAVING`
- `CASE` expressions in `SC`
- validation for both built-in formats
- policy enforcement
- capability checks
- audit/diagnostic mode
- custom operator extension APIs

---

## Installation

Install the package:

```bash
pnpm add query-kit-core
```

Install the runtime libraries your app actually uses:

- Sequelize apps:

```bash
pnpm add sequelize
```

- Mongoose apps:

```bash
pnpm add mongoose
```

- TypeORM apps:

```bash
pnpm add typeorm
```

If you use NestJS, your app should already have:

- `@nestjs/common`
- `@nestjs/core`

---

## Quick start

### Standalone `SC` + Sequelize example

```ts
import {
  FilterProcessor,
  FilterRegistry,
  SCFormat,
  SCFormatValidator,
  SequelizeAdapter,
} from 'query-kit-core';

const registry = new FilterRegistry();

registry.registerFormatRegistration({
  format: new SCFormat(),
  validator: new SCFormatValidator(),
});

registry.registerAdapter(new SequelizeAdapter());

const processor = new FilterProcessor(registry, {
  defaultFormat: 'scfilter',
  defaultOrm: 'sequelize',
  enableValidation: true,
});

const result = processor.processWith({
  query: 'status:eq:active;price:between:100,200;@sort:-createdAt;@limit:20',
  adapterOptions: {
    model: ProductModel,
    dialect: 'postgres',
  },
  pipeline: {
    validate: true,
    schema: {
      status: { type: 'string' },
      price: { type: 'number' },
      createdAt: { type: 'date' },
    },
  },
});
```

### Standalone `MC` + Mongoose example

```ts
import {
  FilterProcessor,
  FilterRegistry,
  MCFormat,
  MCFormatValidator,
  MongooseAdapter,
} from 'query-kit-core';

const registry = new FilterRegistry();

registry.registerFormatRegistration({
  format: new MCFormat(),
  validator: new MCFormatValidator(),
});

registry.registerAdapter(new MongooseAdapter());

const processor = new FilterProcessor(registry, {
  defaultFormat: 'mcfilter',
  defaultOrm: 'mongoose',
  enableValidation: true,
});

const result = processor.processWith({
  query: 'status:$eq:active;tags:$in:new,hot;@limit:10',
  adapterOptions: {
    model: ProductModel,
  },
  pipeline: {
    validate: true,
    schema: {
      status: { type: 'string' },
      tags: { type: 'array' },
    },
  },
});
```

---

## NestJS setup

`FilterModule` is the built-in Nest integration.

```ts
import { Module } from '@nestjs/common';
import { FilterModule } from 'query-kit-core';

@Module({
  imports: [
    FilterModule.forRoot({
      defaultFormat: 'scfilter',
      defaultOrm: 'sequelize',
      enableValidation: true,
      validationOptions: {
        strictMode: true,
        allowNestedFields: true,
        allowRelations: true,
        maxConditions: 50,
        maxValueLength: 1000,
      },
      mcValidationOptions: {
        strictMode: true,
        allowNestedFields: true,
        allowObjectOperators: false,
        maxConditions: 50,
        maxValueLength: 2000,
      },
      policy: {
        maxExpressionDepth: 4,
        maxJoins: 6,
        maxArrayLength: 50,
        denyExpensiveOperatorsOnPublicEndpoints: true,
      },
    }),
  ],
})
export class AppModule {}
```

Inject and use `FilterProcessor`:

```ts
import { Injectable } from '@nestjs/common';
import { FilterProcessor } from 'query-kit-core';

@Injectable()
export class ProductsService {
  constructor(private readonly filterProcessor: FilterProcessor) {}

  buildQuery(filterString: string) {
    return this.filterProcessor.processWith({
      query: {
        filterString,
        page: 1,
        size: 20,
      },
      adapterOptions: {
        model: ProductModel,
        dialect: 'postgres',
      },
      pipeline: {
        validate: true,
        schema: {
          status: { type: 'string' },
          price: { type: 'number' },
          createdAt: { type: 'date' },
        },
      },
    });
  }
}
```

### `FilterModule.forRoot()` options

`FilterModuleOptions` extends runtime options and adds validator defaults:

```ts
type FilterModuleOptions = {
  defaultFormat?: string;
  defaultOrm?: string;
  enableValidation?: boolean;
  policy?: FilterPolicyOptions;
  validationOptions?: ValidationOptions;
  mcValidationOptions?: MongoValidationOptions;
};
```

Meaning of each option:

- `defaultFormat`
  - default format when `processWith()` does not explicitly provide one
  - built-in values:
    - `scfilter`
    - `mcfilter`
- `defaultOrm`
  - default adapter when `processWith()` does not explicitly provide one
  - built-in values:
    - `sequelize`
    - `mongoose`
    - `typeorm`
- `enableValidation`
  - turns validation on by default
- `policy`
  - runtime security/performance controls
- `validationOptions`
  - default options for `SCFormatValidator`
- `mcValidationOptions`
  - default options for `MCFormatValidator`

Important: `FilterModule` only sets defaults. Per-request `schema` and
adapter-specific options still belong to each call.

---

## Manual setup without NestJS

If you do not use Nest, create the registry and processor directly:

```ts
const registry = new FilterRegistry();

registry.registerFormatRegistration({
  format: new SCFormat(),
  validator: new SCFormatValidator(),
});

registry.registerAdapter(new SequelizeAdapter());

const processor = new FilterProcessor(registry, {
  defaultFormat: 'scfilter',
  defaultOrm: 'sequelize',
  enableValidation: true,
});
```

---

## Core concepts

### Format

A format parses user syntax into a neutral filter IR.

Built-in formats:

- `SCFormat` → `scfilter`
- `MCFormat` → `mcfilter`

### Validator

A validator checks:

- field names
- operator validity
- value types
- schema rules
- role-based access

Built-in validators:

- `SCFormatValidator`
- `MCFormatValidator`

### Neutral filter IR

Both formats normalize into `FilterIR`. Adapters consume this IR instead of
re-parsing query strings.

### Adapter

An adapter converts `FilterIR` into ORM-native query structures.

Built-in adapters:

- `SequelizeAdapter`
- `MongooseAdapter`
- `TypeOrmAdapter`

---

## Main processing API

`FilterProcessor` is the main orchestration service.

### `process()`

Shorthand for explicit format and explicit adapter:

```ts
processor.process(
  'status:eq:active;@limit:10',
  'scfilter',
  'sequelize',
  {
    model: ProductModel,
    dialect: 'postgres',
  },
);
```

### `processWith()`

The most flexible API:

```ts
processor.processWith({
  query: 'status:eq:active',
  formatName: 'scfilter',
  ormName: 'sequelize',
  adapterOptions: {
    model: ProductModel,
    dialect: 'postgres',
  },
  pipeline: {
    validate: true,
    schema: {
      status: { type: 'string' },
    },
  },
});
```

### Request structure

```ts
type FilterProcessRequest = {
  query: string | Query;
  formatName?: string;
  ormName?: string;
  adapterOptions?: unknown;
  pipeline?: {
    validate?: boolean;
    schema?: unknown;
    validationContext?: unknown;
    policy?: FilterPolicyOptions;
  };
};
```

### Runtime defaults

```ts
type FilterRuntimeOptions = {
  defaultFormat?: string;
  defaultOrm?: string;
  enableValidation?: boolean;
  policy?: FilterPolicyOptions;
};
```

---

## Query object shape

Instead of passing a raw string, you can pass a structured query object.

```ts
type Query = {
  filterString: string;
  sortString?: string;
  page?: number;
  size?: number;
  offset?: number;
  fields?: string[];
  relations?: RelationDirective;
  customInclude?: RelationDirective;
};
```

Meaning of each field:

- `filterString`
  - the raw filter expression
- `sortString`
  - external sort definition
  - syntax differs by format:
    - `SC`: `createdAt:desc;name:asc`
    - `MC`: same semantics as `@sort`, for example `-createdAt,name`
- `page`
  - page number used with `size`
- `size`
  - requested limit
- `offset`
  - explicit offset override
- `fields`
  - projection fields
- `relations`
  - normalized relation/include definition
- `customInclude`
  - legacy-compatible relation alias

Inline directives in `filterString` override matching external query fields.
Examples:

- `@limit` overrides `size`
- `@page` overrides `page`
- `@offset` overrides `offset`
- `@fields` overrides `fields`
- inline `@sort` overrides external `sortString`
- inline include/populate overrides `relations` / `customInclude`

---

## Built-in formats

### `scfilter`

Human-readable SQL-style syntax:

```text
field:operator:value
```

Example:

```text
status:eq:active;price:between:100,200
```

### `mcfilter`

Mongo-style syntax:

```text
field:$operator:value
```

Example:

```text
status:$eq:active;tags:$in:new,hot
```

---

## SC format reference

### Basic condition syntax

```text
field:operator:value
```

Examples:

```text
status:eq:active
price:gte:100
createdAt:date:2024-01-01
```

### Multiple conditions

Top-level conditions are separated with `;`:

```text
status:eq:active;price:gte:100;deletedAt:isNull:true
```

### Logical operators

`SC` supports:

- `;` → `AND`
- `|` → `OR`
- `!` → `NOT`
- parentheses for grouping

Examples:

```text
status:eq:active|status:eq:pending
```

```text
!deletedAt:exists:true
```

```text
(status:eq:active|status:eq:pending);price:gte:100
```

### Escaping in SC

Reserved characters can be escaped:

- `\:` for literal colon
- `\,` for literal comma
- `\;` for literal semicolon
- `\\` for literal backslash

Examples:

```text
title:eq:Hello\: World
```

```text
tags:in:red\,blue,green
```

### SC sort syntax

There are two SC sort syntaxes.

Inline directive:

```text
@sort:-createdAt,name
```

External `sortString`:

```text
createdAt:desc;name:asc
```

### SC CASE expressions

`SC` supports inline CASE syntax:

```text
case:priority;when:amount:gte:1000:then:high;when:amount:lt:1000:then:low;else:unknown
```

Meaning:

- `case:priority` → output field
- each `when:...:then:...` block defines one branch
- `else:...` is optional fallback

Built-in case-expression support:

- `SequelizeAdapter` → yes
- `TypeOrmAdapter` → yes
- `MongooseAdapter` → no

---

## MC format reference

### Basic condition syntax

```text
field:$operator:value
```

Examples:

```text
status:$eq:active
age:$gte:18
tags:$in:new,hot
```

### Multiple conditions

Top-level conditions are separated with `;`:

```text
status:$eq:active;age:$gte:18;tags:$in:new,hot
```

`MC` does not build the same logical-expression tree syntax as `SC`.

### JSON/object values

`MC` supports object payloads for operators like `elemMatch`:

```text
meta:$elemMatch:{"published":true}
```

### Escaping in MC

MC supports escaped separators:

- `\:` for literal colon
- `\,` for literal comma
- `\;` for literal semicolon

### MC sort syntax

For `MC`, both inline `@sort` and external `sortString` use the same syntax:

```text
-createdAt,name
```

Examples:

```text
@sort:-createdAt,name
```

```ts
query: {
  filterString: 'status:$eq:active',
  sortString: '-createdAt,name',
}
```

### MC include/populate directives

`MC` supports both:

- `@include`
- `@populate`

Example:

```text
status:$eq:active;@populate:profile,orders.items
```

---

## Directives

Directives begin with `@`.

### Common directives

#### `@sort`

Sort fields:

```text
@sort:-createdAt,name
```

Rules:

- `-field` → descending
- `+field` or `field` → ascending

#### `@limit`

```text
@limit:20
```

#### `@page`

```text
@page:2
```

#### `@offset`

```text
@offset:40
```

#### `@fields`

```text
@fields:id,name,status
```

#### `@aggregate`

```text
@aggregate:count(*):total,sum(amount):totalAmount,avg(score):avgScore
```

Supported metric operators:

- `count`
- `sum`
- `avg`
- `min`
- `max`

#### `@groupBy`

```text
@groupBy:status,category
```

#### `@having`

```text
@having:totalAmount:gte:100
```

### Format-specific relation directives

`SC`:

```text
@include:profile,orders.items
```

`MC`:

```text
@include:profile,orders.items
```

or

```text
@populate:profile,orders.items
```

---

## Operator reference

### SC operators

| Operator | Meaning | Example |
| --- | --- | --- |
| `eq` | equals | `status:eq:active` |
| `neq` | not equals | `status:neq:archived` |
| `gt` | greater than | `price:gt:100` |
| `gte` | greater than or equal | `price:gte:100` |
| `lt` | less than | `price:lt:100` |
| `lte` | less than or equal | `price:lte:100` |
| `between` | inclusive range | `price:between:100,200` |
| `like` | SQL like | `name:like:%john%` |
| `iLike` | case-insensitive like | `name:iLike:%john%` |
| `notLike` | negated like | `name:notLike:%test%` |
| `contains` | contains substring | `title:contains:open` |
| `startsWith` | prefix match | `slug:startsWith:prod-` |
| `endsWith` | suffix match | `email:endsWith:@example.com` |
| `regex` | regular expression | `title:regex:^[A-Z]` |
| `in` | value in set | `status:in:active,pending` |
| `notIn` | value not in set | `status:notIn:archived,deleted` |
| `any` | array overlap | `tags:any:new,hot` |
| `all` | array contains all | `roles:all:admin,editor` |
| `size` | array size | `tags:size:3` |
| `isNull` | field is null | `deletedAt:isNull:true` |
| `isNotNull` | field is not null | `deletedAt:isNotNull:true` |
| `exists` | field exists / is not null | `profile:exists:true` |
| `notExists` | field does not exist / is null | `profile:notExists:true` |
| `date` | exact date | `createdAt:date:2024-01-01` |
| `year` | year component | `createdAt:year:2024` |
| `month` | year-month component | `createdAt:month:2024-05` |
| `day` | day-of-month component | `createdAt:day:15` |

How SC values are parsed:

- `eq` / `neq`
  - auto-detects `true`, `false`, `null`, numeric strings
- `between`
  - exactly two comma-separated values
- `in` / `notIn` / `any` / `all`
  - comma-separated lists
- `gt` / `gte` / `lt` / `lte` / `size`
  - numeric
- `isNull` / `isNotNull` / `exists` / `notExists`
  - boolean `true` / `false`
- `date`
  - `YYYY-MM-DD`
- `year`
  - `YYYY`
- `month`
  - `YYYY-MM`
- `day`
  - integer

### MC operators

| Operator | Meaning | Example |
| --- | --- | --- |
| `eq` / `$eq` | equals | `status:$eq:active` |
| `neq` / `$ne` / `$neq` | not equals | `status:$ne:archived` |
| `gt` / `$gt` | greater than | `age:$gt:18` |
| `gte` / `$gte` | greater than or equal | `age:$gte:18` |
| `lt` / `$lt` | less than | `age:$lt:65` |
| `lte` / `$lte` | less than or equal | `age:$lte:65` |
| `in` / `$in` | in array | `tags:$in:new,hot` |
| `notIn` / `$nin` | not in array | `tags:$nin:spam,trash` |
| `all` / `$all` | contains all | `roles:$all:admin,editor` |
| `regex` / `$regex` | regex match | `title:$regex:^[A-Z]` |
| `exists` / `$exists` | existence check | `deletedAt:$exists:false` |
| `size` / `$size` | array size | `tags:$size:2` |
| `elemMatch` / `$elemMatch` | element/object match | `meta:$elemMatch:{"published":true}` |

How MC values are parsed:

- `in` / `notIn` / `all`
  - comma-separated lists
- `gt` / `gte` / `lt` / `lte` / `size`
  - numeric
- `exists`
  - boolean
- `regex`
  - regex string
- `elemMatch`
  - JSON object
- `eq` / `neq`
  - type-aware when schema is present

---

## Validation

Validation is optional but recommended.

You can enable it:

- globally via processor runtime options
- globally via `FilterModule.forRoot()`
- per request via `pipeline.validate`

### SC validation schema

```ts
type FieldSchema = {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  allowedOperators?: string[];
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  nestedFields?: Record<string, FieldSchema>;
  relations?: string[];
  transform?: ValueTransformer<FieldSchema>;
  validate?: ValidationHook<FieldSchema>;
  access?: RoleAccessPolicy;
};
```

### MC validation schema

```ts
type MongoFieldSchema = {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  allowedOperators?: string[];
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  nestedFields?: Record<string, MongoFieldSchema>;
  transform?: ValueTransformer<MongoFieldSchema>;
  validate?: ValidationHook<MongoFieldSchema>;
  access?: RoleAccessPolicy;
};
```

### `SCFormatValidator` options

```ts
type ValidationOptions = {
  allowedFields?: Record<string, FieldSchema>;
  fieldWhitelist?: string[];
  fieldBlacklist?: string[];
  roleFieldAccess?: Record<string, RoleFieldAccessPolicy>;
  validationContext?: ValidationContext;
  customValidator?: ValidationHook<FieldSchema>;
  maxConditions?: number;
  maxValueLength?: number;
  allowNestedFields?: boolean;
  allowRelations?: boolean;
  strictMode?: boolean;
};
```

### `MCFormatValidator` options

```ts
type MongoValidationOptions = {
  allowedFields?: Record<string, MongoFieldSchema>;
  fieldWhitelist?: string[];
  fieldBlacklist?: string[];
  roleFieldAccess?: Record<string, RoleFieldAccessPolicy>;
  validationContext?: ValidationContext;
  customValidator?: ValidationHook<MongoFieldSchema>;
  maxConditions?: number;
  maxValueLength?: number;
  allowNestedFields?: boolean;
  strictMode?: boolean;
  allowObjectOperators?: boolean;
};
```

What the main validator options do:

- `allowedFields`
  - global schema map
- `fieldWhitelist`
  - only listed fields are allowed
- `fieldBlacklist`
  - blocked fields
- `roleFieldAccess`
  - role-based field access map
- `validationContext`
  - default context passed into hooks
- `customValidator`
  - global validation hook
- `maxConditions`
  - maximum number of parsed conditions
- `maxValueLength`
  - maximum raw value length
- `allowNestedFields`
  - whether dotted field names are allowed
- `allowRelations`
  - SC-only relation-depth validation hint
- `strictMode`
  - reject schema-unknown fields
- `allowObjectOperators`
  - MC-only object-payload safety switch

### Examples

Whitelist / blacklist:

```ts
const validator = new SCFormatValidator({
  fieldWhitelist: ['status', 'profile'],
  fieldBlacklist: ['status.internal'],
});
```

Per-field transform:

```ts
const validator = new SCFormatValidator();

validator.validate('status:eq:active', {
  status: {
    type: 'string',
    enum: ['ACTIVE'],
    transform: ({ value }) => String(value).toUpperCase(),
  },
});
```

Global custom validator:

```ts
const validator = new SCFormatValidator({
  customValidator: ({ field, value }) => {
    if (field === 'score' && value > 90) {
      return {
        code: 'GLOBAL_SCORE_WARNING',
        message: 'score is unusually high',
        level: 'warning',
      };
    }
  },
});
```

Role-based access:

```ts
validator.validate(
  'status:eq:active;salary:eq:1000',
  {
    salary: { type: 'number', access: { allowRoles: ['admin'] } },
    status: { type: 'string' },
  },
  { role: 'user' },
);
```

---

## Policy layer

Policies are runtime safety and performance controls.

```ts
type FilterPolicyOptions = {
  maxExpressionDepth?: number;
  maxRelationDepth?: number;
  maxJoins?: number;
  maxPopulates?: number;
  maxArrayLength?: number;
  regex?: {
    maxLength?: number;
    maxGroupCount?: number;
    maxAlternationCount?: number;
    maxQuantifierCount?: number;
    maxComplexityScore?: number;
    denyNestedQuantifiers?: boolean;
  };
  denyExpensiveOperatorsOnPublicEndpoints?: boolean;
  expensiveOperators?: string[];
};
```

What policy can restrict:

- logical-expression depth
- relation depth
- total join/include/populate count
- array length
- regex complexity
- expensive operators on public endpoints

Example:

```ts
const processor = new FilterProcessor(registry, {
  defaultFormat: 'scfilter',
  defaultOrm: 'sequelize',
  enableValidation: true,
  policy: {
    maxExpressionDepth: 3,
    maxRelationDepth: 2,
    maxJoins: 4,
    maxArrayLength: 50,
    denyExpensiveOperatorsOnPublicEndpoints: true,
    regex: {
      maxLength: 256,
      maxComplexityScore: 80,
      denyNestedQuantifiers: true,
    },
  },
});
```

---

## Relations and include/populate

Relations are normalized through a backend-neutral shape:

```ts
type RelationDefinition = {
  path: string;
  fields?: string[];
  nested?: RelationDirective;
  required?: boolean;
};
```

Simple input:

```ts
relations: ['profile', 'orders.items']
```

Structured input:

```ts
relations: [
  { path: 'profile', fields: ['name', 'email'] },
  {
    path: 'orders',
    required: true,
    nested: [{ path: 'items', fields: ['sku'] }],
  },
]
```

Meaning:

- `path`
  - relation path
- `fields`
  - selected fields for that relation
- `nested`
  - nested includes/populates
- `required`
  - required join/include when supported

Adapter behavior:

- `SequelizeAdapter`
  - supports structured include conversion
  - supports `required`
- `TypeOrmAdapter`
  - supports structured join conversion
  - supports `required`
  - may require `innerJoin()` or `innerJoinAndSelect()`
- `MongooseAdapter`
  - converts relations into `populate()`
  - rejects `required: true`

Adapter-specific relation maps:

- Sequelize → `includeMap`
- Mongoose → `populateMap`
- TypeORM → `includeMap`

---

## Aggregation

Both built-in formats support:

- `@groupBy`
- `@aggregate`
- `@having`

Example:

```text
status:eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount;@having:totalAmount:gte:100
```

Supported metric operators:

- `count`
- `sum`
- `avg`
- `min`
- `max`

Examples:

```text
@aggregate:count(*):total
```

```text
@aggregate:sum(amount):totalAmount,avg(score):avgScore
```

Important aggregation rules:

- `having` fields must reference:
  - a `groupBy` field, or
  - an aggregation alias
- projected fields must be valid grouped fields or aliases
- sort fields must be valid grouped fields or aliases

Valid example:

```text
status:eq:active;@groupBy:status;@aggregate:sum(amount):totalAmount;@fields:status,totalAmount;@sort:-totalAmount;@having:totalAmount:gt:100
```

---

## CASE expressions

CASE expressions are available in `SC`.

Syntax:

```text
case:outputField;when:field:operator:value:then:result;when:field:operator:value:then:result;else:fallback
```

Example:

```text
case:priority;when:amount:gte:1000:then:high;when:amount:lt:1000:then:low;else:unknown
```

Built-in adapter support:

- Sequelize → supported
- TypeORM → supported
- Mongoose → not supported

---

## Adapter reference

### Sequelize adapter

Options:

```ts
type SequelizeAdapterOptions = {
  model: ModelStatic<Model>;
  dialect?: 'postgres' | 'mysql' | 'sqlite';
  fieldMap?: Record<string, string>;
  includeMap?: Record<string, Includeable>;
  defaultLimit?: number;
  maxLimit?: number;
};
```

Returns an object like:

```ts
{
  where,
  order,
  limit,
  offset,
  include?,
  attributes?,
  group?,
  having?,
}
```

Dialect notes:

- `regex` → `postgres`, `mysql`
- `any`, `all`, `size` → `postgres`
- common comparison/string/date operators → `postgres`, `mysql`, `sqlite`

### Mongoose adapter

Options:

```ts
type MongooseAdapterOptions = {
  model: MongooseModelLike;
  fieldMap?: Record<string, string>;
  populateMap?: Record<string, MongoosePopulateDefinition | string>;
  defaultLimit?: number;
  maxLimit?: number;
};
```

Behavior:

- non-aggregation filters use `find()`
- aggregation filters require `aggregate()`
- relations become `populate()`
- `required` relations are not supported

### TypeORM adapter

Options:

```ts
type TypeOrmAdapterOptions = {
  queryBuilder: TypeOrmQueryBuilderLike;
  dialect?: 'postgres' | 'mysql' | 'sqlite';
  rootAlias?: string;
  fieldMap?: Record<string, string>;
  includeMap?: Record<string, TypeOrmJoinDefinition>;
  defaultLimit?: number;
  maxLimit?: number;
};
```

Behavior:

- mutates the provided query builder
- supports joins, projection, pagination, sorting, aggregation, and case expressions
- required joins may need `innerJoin()` / `innerJoinAndSelect()`

---

## Audit mode

Use `audit()` / `auditWith()` when you want diagnostics without throwing.

Example:

```ts
const audit = processor.auditWith({
  query: 'status:eq:active;@groupBy:status;@aggregate:count(*):total;@having:total:gte:1',
  formatName: 'scfilter',
  ormName: 'sequelize',
  adapterOptions: {
    model: ProductModel,
    dialect: 'postgres',
  },
  pipeline: {
    validate: true,
    schema: {
      status: { type: 'string' },
    },
  },
});
```

Useful fields in the result:

- `ok`
- `parsedAst`
- `filterIr`
- `appliedValidationRules`
- `validationErrors`
- `validationWarnings`
- `unsupportedFeatures`
- `chosenAdapterStrategy`
- `result`
- `error`

---

## Custom operators and extension points

You can extend formats and adapters without changing package core.

### Register a bundle

```ts
import { registerFilterOperatorBundle } from 'query-kit-core';

registerFilterOperatorBundle({
  operator: 'jsonContains',
  formats: {
    scfilter: {
      aliases: ['jsoncontains'],
      supportedFieldTypes: ['object'],
      parseValue: (rawValue) => JSON.parse(rawValue),
      validate: ({ value }) => {
        if (!value || Array.isArray(value) || typeof value !== 'object') {
          return {
            code: 'JSON_OBJECT_REQUIRED',
            message: 'jsonContains requires a JSON object payload',
          };
        }
      },
    },
  },
  adapters: {
    typeorm: {
      apply: ({ field, value, parameterName }) => ({
        condition: `${field} @> :${parameterName}`,
        parameters: { [parameterName]: JSON.stringify(value) },
      }),
    },
  },
});
```

### Register only a format operator

```ts
import { registerFormatOperator } from 'query-kit-core';

registerFormatOperator('mcfilter', {
  operator: 'geoWithin',
  aliases: ['geowithin'],
  supportedFieldTypes: ['object'],
  parseValue: (rawValue, context) => context.parseObjectLiteral(rawValue),
});
```

### Register only an adapter operator

```ts
import { registerAdapterOperator } from 'query-kit-core';

registerAdapterOperator('mongoose', {
  operator: 'geoWithin',
  apply: ({ value }) => ({ $geoWithin: value }),
});
```

Main extension APIs:

- `registerFormatOperator()`
- `registerAdapterOperator()`
- `registerFilterOperatorBundle()`
- `getDefaultFilterOperatorRegistry()`

---

## Public exports

Primary public APIs:

- `FilterProcessor`
- `FilterRegistry`
- `FilterModule`
- `SCFormat`
- `MCFormat`
- `SCFormatValidator`
- `MCFormatValidator`
- `SequelizeAdapter`
- `MongooseAdapter`
- `TypeOrmAdapter`
- `createFilterIR`
- `registerFormatOperator`
- `registerAdapterOperator`
- `registerFilterOperatorBundle`
- `getDefaultFilterOperatorRegistry`

---

## Limitations and compatibility notes

### General

- `SC` and `MC` are intentionally different syntaxes.
- Inline directives can override external query fields.
- Validation is optional; parsing can still run without it.

### SC-specific

- Logical expressions (`|`, `!`, parentheses) are only available in `SC`.
- CASE expressions are only available in `SC`.
- External `sortString` syntax differs from inline `@sort`.

### MC-specific

- `MC` does not expose the same logical-expression grammar as `SC`.
- Object payloads such as `elemMatch` must be valid JSON objects.

### SQL dialect constraints

- `regex` is not supported by built-in SQL adapters on SQLite.
- `any`, `all`, and `size` are PostgreSQL-specific in built-in SQL adapters.

### Mongoose relation limitation

- `required: true` is not supported with `populate()`.

### Aggregation semantics

- When aggregation is active, `HAVING`, projection, and sorting must reference
  valid group fields or aggregation aliases.

---

## Troubleshooting

### “Filter format name is required”

Cause:

- neither `formatName` nor `defaultFormat` is set

Fix:

- pass `formatName`, or
- configure `defaultFormat`

### “Adapter name is required”

Cause:

- neither `ormName` nor `defaultOrm` is set

Fix:

- pass `ormName`, or
- configure `defaultOrm`

### Validation is not running

Check:

- `enableValidation: true`, or
- `pipeline.validate: true`
- a validator is actually registered for the selected format

### Unsupported operator errors

Check:

- spelling
- format syntax (`eq` vs `$eq`)
- schema `allowedOperators`
- SQL dialect support

### Aggregation semantic validation errors

Check:

- `@having` references a grouped field or aggregation alias
- `@fields` only selects grouped fields or aliases
- `@sort` only sorts by grouped fields or aliases

### Mongoose required relation error

Cause:

- `required: true` was used with Mongoose populate relations

Fix:

- remove `required`, or
- use a different backend strategy for that query

---

## Recommended usage pattern

For most applications:

1. Pick one public format:
   - `scfilter` for human-readable SQL-like syntax
   - `mcfilter` for Mongo-like syntax
2. Enable validation.
3. Define schemas for public fields.
4. Add policies for public endpoints.
5. Use audit mode for debugging and observability.
6. Add custom operators through the registry instead of modifying core.

---

## Canonical documentation note

This README is the canonical user documentation for `query-kit-core`. The
previous scattered Markdown documentation has been removed, and future package
documentation should be based on this document.
