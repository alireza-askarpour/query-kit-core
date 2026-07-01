# SQL Dialect Support

This package currently defines explicit SQL-dialect support for:

- `postgres`
- `mysql`
- `sqlite`

## Operator matrix

| Operator | Postgres | MySQL | SQLite |
| --- | --- | --- | --- |
| `eq`, `neq`, `gt`, `gte`, `lt`, `lte` | yes | yes | yes |
| `between` | yes | yes | yes |
| `like`, `notLike`, `contains`, `startsWith`, `endsWith` | yes | yes | yes |
| `iLike` | native | emulated | emulated |
| `regex` | yes | yes | no |
| `in`, `notIn` | yes | yes | yes |
| `any`, `all`, `size` | yes | no | no |
| `isNull`, `isNotNull`, `exists`, `notExists` | yes | yes | yes |
| `date`, `year`, `month`, `day` | yes | yes | yes |

## Fail-fast behavior

If an operator is not supported for the selected dialect, SQL adapters throw a runtime error before building the query.

Example:

```text
Operator "any" is not supported by TypeORM adapter for SQL dialect "mysql"
```

## Notes

- `iLike` is emulated with `LOWER(field) LIKE LOWER(value)` outside Postgres.
- `regex` is only exposed for `postgres` and `mysql`.
- array-oriented operators are currently Postgres-only.
