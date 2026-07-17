# query-kit-builder

`query-kit-builder` is the frontend-side companion package for `query-kit-core`.

It helps frontend developers create filter query strings and payload objects that
match the parsing and execution features of `query-kit-core`.

## What it builds

- `SC` query strings
- `MC` query strings
- payload objects compatible with `query-kit-core`
- URL query parameters for HTTP requests
- sorting, pagination, fields, includes/populate
- aggregation, group by, and having
- `SC` logical expressions and case expressions

## Install

```bash
pnpm add query-kit-builder
```

```bash
npm install query-kit-builder
```

## SC example

```ts
import { createSCQueryBuilder } from 'query-kit-builder';

const payload = createSCQueryBuilder()
  .where('status', 'eq', 'active')
  .orGroup((group) => {
    group.where('price', 'gte', 100).where('price', 'lte', 500);
  })
  .sortDesc('createdAt')
  .limit(20)
  .page(2)
  .fields('id', 'name')
  .include('profile', 'orders.items')
  .buildPayload();
```

## MC example

```ts
import { createMCQueryBuilder } from 'query-kit-builder';

const query = createMCQueryBuilder()
  .where('status', 'eq', 'active')
  .where('tags', 'in', ['new', 'hot'])
  .populate('profile')
  .sortDesc('createdAt')
  .build();
```

## Output modes

- `build()` returns a single inline filter string
- `buildPayload()` returns a payload object
- `toURLSearchParams()` returns `URLSearchParams`

## Notes

- `SC` supports logical groups and `case(...)` builders
- `MC` focuses on Mongo-style condition strings and directives
- complex relation objects are supported in payload mode
- inline relation directives only support string relation paths
