# TypeORM Adapter

The TypeORM adapter converts `FilterIR` into `QueryBuilder` operations.

## Design

Unlike the earlier monolithic implementation, the adapter is now split into focused modules.

## Files

- `typeorm.adapter.ts`: orchestration layer
- `typeorm.types.ts`: query builder and option contracts
- `typeorm-where.builder.ts`: operator-to-clause mapping
- `typeorm.utils.ts`: joins, sorting, field selection, pagination, case rendering

## Responsibilities

- convert conditions into `andWhere(...)`
- convert sort into `addOrderBy(...)`
- convert field selection into `select(...)`
- convert include paths into joins
- convert pagination into `take(...)` and `skip(...)`
- convert case expressions into `addSelect(...)`
- enforce dialect-aware operator support for `postgres`, `mysql`, and `sqlite`

## Extension notes

To add a new operator:

1. update normalized/operator support if needed
2. add a handler in `typeorm-where.builder.ts`
3. add or adjust tests in `test/typeorm-adapter.test.js`
