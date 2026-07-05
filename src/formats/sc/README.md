# SC Format

The `SC` format is the built-in query-string syntax currently used in this package.

## Syntax

Basic condition:

```text
field:operator:value
```

Examples:

```text
status:eq:active
price:between:100,200
name:contains:john
createdAt:year:2024
```

Logical groups:

```text
(status:eq:active|status:eq:pending);price:gt:100
!(deletedAt:exists:true|archived:eq:true)
```

Operators for grouping:

- `;` => `and`
- `|` => `or`
- `!` => `not`
- `(...)` => nested group

## Directives

Supported directives inside the query string:

- `@sort`
- `@limit`
- `@page`
- `@offset`
- `@fields`
- `@include`
- `@groupBy`
- `@aggregate`
- `@having`

Examples:

```text
status:eq:active;@sort:-createdAt;@limit:20
status:eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount;@having:totalAmount:gte:100
```

## Internal structure

The SC format is intentionally split into focused modules:

- validator orchestrator: [sc-format.validator.ts](./sc-format.validator.ts)
- parser: [sc-format-validation.parser.ts](./sc-format-validation.parser.ts)
- constants: [sc-format-validation.constants.ts](./sc-format-validation.constants.ts)
- schema helpers: [sc-format-validation.schema.ts](./sc-format-validation.schema.ts)
- value parsing and schema checks: [sc-format-validation.value.ts](./sc-format-validation.value.ts)
- security rules: [sc-format-validation.security.ts](./sc-format-validation.security.ts)

## Responsibilities

### `SCFormat`

- parse filter syntax
- parse directives
- normalize operator aliases
- build `FilterIR`

### `SCFormatValidator`

- validate field names
- validate operator availability
- validate value types
- validate schema-based constraints
- enforce field whitelist / blacklist
- apply per-field transformers
- run per-field and global validator hooks
- enforce role-based field access
- perform lightweight security checks

## Extension notes

If the SC syntax grows further:

- add constants to `sc-format-validation.constants.ts`
- add parser behavior to `sc-format-validation.parser.ts`
- add value parsing to `sc-format-validation.value.ts`
- add rule checks to `sc-format-validation.schema.ts`
