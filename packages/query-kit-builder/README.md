# query-kit-builder

`query-kit-builder` is the frontend-side companion package for
`query-kit-core`.

It helps frontend developers build filter query strings, payload objects, and
URL query parameters that are intentionally shaped for `query-kit-core`.

This package does **not** parse or execute queries. It only constructs request
input for the backend package.

---

## Table of contents

- [What this package does](#what-this-package-does)
- [When to install it](#when-to-install-it)
- [Installation](#installation)
- [How it relates to query-kit-core](#how-it-relates-to-query-kit-core)
- [Exports](#exports)
- [Quick start](#quick-start)
- [SC builder](#sc-builder)
- [MC builder](#mc-builder)
- [Output modes](#output-modes)
- [Payload shape](#payload-shape)
- [URLSearchParams output](#urlsearchparams-output)
- [Sorting and pagination](#sorting-and-pagination)
- [Relations and includepopulate](#relations-and-includepopulate)
- [Aggregation](#aggregation)
- [SC logical expressions](#sc-logical-expressions)
- [SC case expressions](#sc-case-expressions)
- [Value formatting rules](#value-formatting-rules)
- [Error cases and limitations](#error-cases-and-limitations)
- [Recommended frontend usage pattern](#recommended-frontend-usage-pattern)

---

## What this package does

`query-kit-builder` builds request input for APIs that use `query-kit-core`.

It supports:

- `SC` query string generation
- `MC` query string generation
- payload objects compatible with `query-kit-core`
- `URLSearchParams` output for HTTP requests
- sort, page, limit, offset, fields
- include / populate directives
- aggregation, groupBy, and having
- `SC` logical groups
- `SC` case expressions

It is designed for:

- `React`
- `Next.js`
- `Vue`
- `Nuxt`
- `Angular`
- plain TypeScript frontend apps

---

## When to install it

Install `query-kit-builder` when:

- your frontend needs to build filter query strings
- your frontend needs to build payload objects for a backend endpoint
- your backend already uses `query-kit-core`
- you want one consistent query contract between frontend and backend

Do **not** install this package just to parse or validate filters on the
backend. That is the job of `query-kit-core`.

---

## Installation

### `pnpm`

```bash
pnpm add query-kit-builder
```

### `npm`

```bash
npm install query-kit-builder
```

This package has no ORM dependency, because it does not execute queries. It
only builds strings and payloads.

---

## How it relates to query-kit-core

The two packages are complementary but independent:

- `query-kit-builder`
  - frontend/client package
  - builds query strings and payloads
- `query-kit-core`
  - backend/runtime package
  - parses, validates, normalizes, and converts those queries

Typical architecture:

- frontend app → install `query-kit-builder`
- backend app → install `query-kit-core`

---

## Exports

Main exports:

- `createSCQueryBuilder()`
- `createMCQueryBuilder()`
- `SCQueryBuilder`
- `MCQueryBuilder`
- shared types from `types.ts`

Example:

```ts
import {
  createSCQueryBuilder,
  createMCQueryBuilder,
} from 'query-kit-builder';
```

---

## Quick start

### `SC` quick start

```ts
import { createSCQueryBuilder } from 'query-kit-builder';

const payload = createSCQueryBuilder()
  .where('product.status', 'eq', 'active')
  .where('product.price', 'between', [100, 500])
  .sortDesc('product.createdAt')
  .limit(20)
  .page(2)
  .fields('id', 'name', 'price', 'status')
  .include('category')
  .buildPayload();
```

Result:

```ts
{
  filterString: 'product.status:eq:active;product.price:between:100,500',
  sortString: 'product.createdAt:desc',
  page: 2,
  size: 20,
  offset: undefined,
  fields: ['id', 'name', 'price', 'status'],
  relations: ['category'],
  customInclude: ['category']
}
```

### `MC` quick start

```ts
import { createMCQueryBuilder } from 'query-kit-builder';

const query = createMCQueryBuilder()
  .where('product.status', 'eq', 'active')
  .where('product.tags', 'in', ['new', 'hot'])
  .sortDesc('product.createdAt')
  .populate('category')
  .build();
```

Result:

```text
product.status:$eq:active;product.tags:$in:new,hot;@sort:-product.createdAt;@populate:category
```

---

## SC builder

`SC` builds SQL-style filter strings compatible with the `scfilter` format in
`query-kit-core`.

### Available methods

- `where(field, operator, value)`
- `orWhere(field, operator, value)`
- `andGroup(callback)`
- `orGroup(callback)`
- `not(callback)`
- `sortBy(field, direction)`
- `sortAsc(field)`
- `sortDesc(field)`
- `limit(value)`
- `page(value)`
- `offset(value)`
- `fields(...fields)`
- `include(...relations)`
- `relations(relations)`
- `aggregate(fn, field, alias)`
- `groupBy(...fields)`
- `having(field, operator, value)`
- `case(outputField, callback)`
- `build()`
- `buildPayload()`
- `toURLSearchParams()`

### Basic example

```ts
const query = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .where('price', 'gte', 100)
  .where('price', 'lte', 500)
  .build();
```

Output:

```text
status:eq:active;price:gte:100;price:lte:500
```

### Supported SC operators

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `between`
- `like`
- `iLike`
- `notLike`
- `contains`
- `startsWith`
- `endsWith`
- `regex`
- `in`
- `notIn`
- `any`
- `all`
- `size`
- `isNull`
- `isNotNull`
- `exists`
- `notExists`
- `date`
- `year`
- `month`
- `day`

Examples:

```ts
createSCQueryBuilder().where('status', 'eq', 'active').build();
```

```text
status:eq:active
```

```ts
createSCQueryBuilder().where('price', 'between', [100, 200]).build();
```

```text
price:between:100,200
```

```ts
createSCQueryBuilder().where('tags', 'in', ['new', 'hot']).build();
```

```text
tags:in:new,hot
```

---

## MC builder

`MC` builds Mongo-style filter strings compatible with the `mcfilter` format in
`query-kit-core`.

### Available methods

- `where(field, operator, value)`
- `sortBy(field, direction)`
- `sortAsc(field)`
- `sortDesc(field)`
- `limit(value)`
- `page(value)`
- `offset(value)`
- `fields(...fields)`
- `include(...relations)`
- `populate(...relations)`
- `relations(relations, keyword?)`
- `aggregate(fn, field, alias)`
- `groupBy(...fields)`
- `having(field, operator, value)`
- `build()`
- `buildPayload()`
- `toURLSearchParams()`

### Basic example

```ts
const query = createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .where('age', 'gte', 18)
  .build();
```

Output:

```text
status:$eq:active;age:$gte:18
```

### Supported MC operators

- `eq` or `$eq`
- `neq` or `$neq`
- `gt` or `$gt`
- `gte` or `$gte`
- `lt` or `$lt`
- `lte` or `$lte`
- `in` or `$in`
- `notIn` or `$notIn`
- `all` or `$all`
- `regex` or `$regex`
- `exists` or `$exists`
- `size` or `$size`
- `elemMatch` or `$elemMatch`

Examples:

```ts
createMCQueryBuilder().where('status', 'eq', 'active').build();
```

```text
status:$eq:active
```

```ts
createMCQueryBuilder().where('tags', '$in', ['new', 'hot']).build();
```

```text
tags:$in:new,hot
```

```ts
createMCQueryBuilder()
  .where('meta', 'elemMatch', { published: true })
  .build();
```

```text
meta:$elemMatch:{"published":true}
```

---

## Output modes

Both builders support three main output modes.

### `build()`

Returns one inline query string with directives embedded in `filterString`.

Example:

```ts
const query = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .sortDesc('createdAt')
  .limit(10)
  .build();
```

Output:

```text
status:eq:active;@sort:-createdAt;@limit:10
```

### `buildPayload()`

Returns a payload object compatible with `query-kit-core`.

By default:

- sort is external
- pagination is external
- fields are external
- relations are external

This is usually the cleanest format for frontend state and API request bodies.

### `toURLSearchParams()`

Returns `URLSearchParams` for use in browser requests.

Example:

```ts
const params = createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .sortDesc('createdAt')
  .limit(10)
  .toURLSearchParams();
```

Typical output:

```text
filter=status%3A%24eq%3Aactive&sort=-createdAt&size=10
```

---

## Payload shape

`buildPayload()` returns:

```ts
type QueryPayload = {
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

This shape is intentionally aligned with `query-kit-core`.

---

## URLSearchParams output

`toURLSearchParams()` accepts two option objects:

### 1) payload options

Controls whether sort/pagination/fields/relations are inlined into
`filterString` or kept external.

```ts
type PayloadBuildOptions = {
  inlineSort?: boolean;
  inlinePagination?: boolean;
  inlineFields?: boolean;
  inlineRelations?: boolean;
};
```

### 2) URL param key options

```ts
type URLSearchParamsOptions = {
  filterKey?: string;
  sortKey?: string;
  pageKey?: string;
  sizeKey?: string;
  offsetKey?: string;
  fieldsKey?: string;
  includeKey?: string;
  relationSerializer?: (relations: RelationDirective) => string;
};
```

Example with custom keys:

```ts
const params = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .toURLSearchParams({}, {
    filterKey: 'q',
    sortKey: 'orderBy',
    sizeKey: 'limit',
  });
```

---

## Sorting and pagination

### Sorting

Methods:

- `sortBy(field, 'asc' | 'desc')`
- `sortAsc(field)`
- `sortDesc(field)`

#### SC external sort

```ts
createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .sortDesc('createdAt')
  .sortAsc('name')
  .buildPayload();
```

Output:

```ts
{
  sortString: 'createdAt:desc;name:asc'
}
```

#### SC inline sort

```ts
createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .sortDesc('createdAt')
  .build();
```

Output:

```text
status:eq:active;@sort:-createdAt
```

#### MC sort

`MC` uses the same comma style for inline and external sort:

```text
-createdAt,name
```

### Pagination

Methods:

- `limit(number)`
- `page(number)`
- `offset(number)`

Example:

```ts
createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .limit(20)
  .page(2)
  .offset(40)
  .build();
```

Output:

```text
status:$eq:active;@limit:20;@page:2;@offset:40
```

---

## Relations and include/populate

### Simple string relations

#### SC

```ts
createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .include('profile', 'orders.items')
  .build();
```

Output:

```text
status:eq:active;@include:profile,orders.items
```

#### MC

```ts
createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .populate('profile', 'orders.items')
  .build();
```

Output:

```text
status:$eq:active;@populate:profile,orders.items
```

### Complex relation directives

For payload mode, you can pass nested relation objects:

```ts
const payload = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .relations([
    {
      path: 'profile',
      fields: ['id', 'avatar'],
    },
    {
      path: 'orders',
      nested: [
        {
          path: 'items',
          fields: ['id', 'sku'],
        },
      ],
    },
  ])
  .buildPayload();
```

Important:

- complex relation objects are supported in `buildPayload()`
- inline relation directives only support simple string relation paths
- `toURLSearchParams()` needs `relationSerializer` for complex relation objects

---

## Aggregation

Both builders support:

- `aggregate(fn, field, alias)`
- `groupBy(...fields)`
- `having(field, operator, value)`

Supported aggregate functions:

- `count`
- `sum`
- `avg`
- `min`
- `max`

Example:

```ts
const query = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .aggregate('sum', 'amount', 'totalAmount')
  .groupBy('status')
  .having('totalAmount', 'gte', 100)
  .build();
```

Output:

```text
status:eq:active;@aggregate:sum(amount):totalAmount;@groupBy:status;@having:totalAmount:gte:100
```

MC example:

```ts
const query = createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .aggregate('count', '*', 'total')
  .groupBy('status')
  .having('total', 'gte', 1)
  .build();
```

Output:

```text
status:$eq:active;@aggregate:count(*):total;@groupBy:status;@having:total:$gte:1
```

---

## SC logical expressions

`SC` supports logical expression building.

Available methods:

- `where(...)`
- `orWhere(...)`
- `andGroup(callback)`
- `orGroup(callback)`
- `not(callback)`

Example:

```ts
const query = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .orGroup((group) => {
    group.where('price', 'gte', 100).where('price', 'lte', 500);
  })
  .build();
```

Output:

```text
status:eq:active|(price:gte:100;price:lte:500)
```

Negation example:

```ts
const query = createSCQueryBuilder()
  .not((group) => {
    group.where('deletedAt', 'exists', true);
  })
  .build();
```

Output:

```text
!(deletedAt:exists:true)
```

---

## SC case expressions

`SC` supports case-expression generation through `.case(...)`.

Example:

```ts
const query = createSCQueryBuilder()
  .case('priority', (expr) => {
    expr
      .when('amount', 'gte', 1000, 'high')
      .when('amount', 'lt', 1000, 'low')
      .else('unknown');
  })
  .build();
```

Output:

```text
case:priority;when:amount:gte:1000:then:high;when:amount:lt:1000:then:low;else:unknown
```

---

## Value formatting rules

### Primitive values

- strings are escaped for `:`, `,`, `;`, and `\`
- numbers become numeric text
- booleans become `true` / `false`
- `null` becomes `null`
- `Date` becomes ISO string

### List operators

These operators expect arrays:

- `SC`: `between`, `in`, `notIn`, `any`, `all`
- `MC`: `in`, `notIn`, `all`

### `elemMatch`

`MC` `elemMatch` requires an object and is serialized as JSON.

---

## Error cases and limitations

### SC limitations

- empty logical groups throw an error
- `between` requires exactly two values
- inline relation directives only support string paths

### MC limitations

- `elemMatch` must receive an object
- array operators require arrays
- inline relation directives only support string paths

### URLSearchParams limitation

If `relations` contains nested relation objects, you must provide a custom
`relationSerializer`:

```ts
const params = builder.toURLSearchParams({}, {
  relationSerializer: (relations) => JSON.stringify(relations),
});
```

---

## Recommended frontend usage pattern

For most applications:

1. keep builder state in UI filters
2. map UI filters into builder calls
3. use `buildPayload()` for structured API requests
4. use `toURLSearchParams()` for GET endpoints
5. use `build()` only when you intentionally want one inline filter string

Recommended split:

- frontend → `query-kit-builder`
- backend → `query-kit-core`

This keeps request generation on the client and parsing/execution on the
server.
