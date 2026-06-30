# Sequelize Adapter

The Sequelize adapter converts `NormalizedFilter` into a Sequelize query object.

## Output shape

The adapter returns a plain object describing:

- `where`
- `order`
- `limit`
- `offset`
- `attributes`
- `include`

## Responsibilities

- map operators to Sequelize operators
- build attribute projections
- support `CASE` expressions
- support includes
- support sorting and pagination

## Current design note

The Sequelize adapter still carries more logic in one file than the newer TypeORM adapter split.

If this adapter continues to grow, it should eventually be split into:

- sequelize types
- sequelize clause builder
- sequelize include helpers
- sequelize attribute builder
