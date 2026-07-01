# Mongoose Adapter

The Mongoose adapter converts `NormalizedFilter` into a Mongoose `find()` query chain.

## Responsibilities

- map supported normalized operators into MongoDB predicates
- apply projection via `select(...)`
- apply sorting and pagination
- apply populate directives

## Supported operators

- `eq`, `neq`
- `gt`, `gte`, `lt`, `lte`
- `in`, `notIn`, `all`
- `regex`, `exists`, `size`
- `elemMatch`
