import { NormalizedCondition } from '../../core';
import {
  assertSqlOperatorSupport,
  SqlDialect,
} from '../sql-dialects';
import {
  TypeOrmClauseBuilderDependencies,
  TypeOrmOperatorHandler,
  TypeOrmWhereClause,
} from './typeorm.types';

export function createTypeOrmOperatorHandlers(
  dependencies: TypeOrmClauseBuilderDependencies,
): Record<NormalizedCondition['operator'], TypeOrmOperatorHandler> {
  const dialect = dependencies.dialect;

  return {
    eq: (field, value, parameterName) =>
      withParameter(`${field} = :${parameterName}`, parameterName, value),
    neq: (field, value, parameterName) =>
      withParameter(`${field} <> :${parameterName}`, parameterName, value),
    gt: (field, value, parameterName) =>
      withParameter(`${field} > :${parameterName}`, parameterName, value),
    gte: (field, value, parameterName) =>
      withParameter(`${field} >= :${parameterName}`, parameterName, value),
    lt: (field, value, parameterName) =>
      withParameter(`${field} < :${parameterName}`, parameterName, value),
    lte: (field, value, parameterName) =>
      withParameter(`${field} <= :${parameterName}`, parameterName, value),
    between: (field, value, parameterName) =>
      buildBetweenClause(field, value, parameterName),
    like: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, value),
    iLike: (field, value, parameterName) =>
      buildCaseInsensitiveLikeClause(field, value, parameterName, dialect),
    notLike: (field, value, parameterName) =>
      withParameter(`${field} NOT LIKE :${parameterName}`, parameterName, value),
    contains: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `%${String(value)}%`),
    startsWith: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `${String(value)}%`),
    endsWith: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `%${String(value)}`),
    regex: (field, value, parameterName) =>
      buildRegexClause(field, value, parameterName, dialect),
    in: (field, value, parameterName) =>
      buildArrayMembershipClause(`${field} IN (:...${parameterName})`, value, parameterName),
    notIn: (field, value, parameterName) =>
      buildArrayMembershipClause(`${field} NOT IN (:...${parameterName})`, value, parameterName),
    any: (field, value, parameterName) =>
      buildArrayOverlapClause(field, value, parameterName, dialect),
    all: (field, value, parameterName) =>
      buildArrayContainsClause(field, value, parameterName, dialect),
    size: (field, value, parameterName) =>
      buildArraySizeClause(field, value, parameterName, dialect),
    isNull: (field, value) => ({ condition: `${field} ${value ? 'IS NULL' : 'IS NOT NULL'}` }),
    isNotNull: (field, value) => ({ condition: `${field} ${value ? 'IS NOT NULL' : 'IS NULL'}` }),
    exists: (field, value) => ({ condition: `${field} ${value ? 'IS NOT NULL' : 'IS NULL'}` }),
    notExists: (field, value) => ({ condition: `${field} ${value ? 'IS NULL' : 'IS NOT NULL'}` }),
    date: (field, value, parameterName) => buildDateClause(field, value, parameterName),
    year: (field, value, parameterName) =>
      buildDatePartClause('year', field, value, parameterName, dialect),
    month: (field, value, parameterName) =>
      buildDatePartClause('month', field, value, parameterName, dialect),
    day: (field, value, parameterName) =>
      buildDatePartClause('day', field, value, parameterName, dialect),
    elemMatch: () => {
      throw new Error('Operator "elemMatch" is not supported in TypeORM adapter');
    },
  };
}

export function buildWhereClause(
  operatorHandlers: Record<NormalizedCondition['operator'], TypeOrmOperatorHandler>,
  field: string,
  operator: NormalizedCondition['operator'],
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  const handler = operatorHandlers[operator];

  if (!handler) {
    throw new Error(`Operator "${operator}" not supported in TypeORM adapter`);
  }

  return handler(field, value, parameterName);
}

function buildBetweenClause(
  field: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Between operator requires an array with exactly two values');
  }

  const [start, end] = value;
  return {
    condition: `${field} BETWEEN :${parameterName}_start AND :${parameterName}_end`,
    parameters: {
      [`${parameterName}_start`]: start,
      [`${parameterName}_end`]: end,
    },
  };
}

function buildArrayMembershipClause(
  condition: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Array membership operators require a non-empty array');
  }

  return {
    condition,
    parameters: {
      [parameterName]: value,
    },
  };
}

function buildDateClause(
  field: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  const date = new Date(String(value));
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);

  return {
    condition: `${field} >= :${parameterName}_start AND ${field} < :${parameterName}_end`,
    parameters: {
      [`${parameterName}_start`]: date,
      [`${parameterName}_end`]: nextDay,
    },
  };
}

function withParameter(
  condition: string,
  parameterName: string,
  value: unknown,
): TypeOrmWhereClause {
  return {
    condition,
    parameters: {
      [parameterName]: value,
    },
  };
}

function buildCaseInsensitiveLikeClause(
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  if (dialect === 'postgres') {
    return withParameter(`${field} ILIKE :${parameterName}`, parameterName, value);
  }

  return withParameter(
    `LOWER(${field}) LIKE LOWER(:${parameterName})`,
    parameterName,
    value,
  );
}

function buildRegexClause(
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  assertSqlOperatorSupport(dialect, 'regex', 'TypeORM adapter');

  if (dialect === 'postgres') {
    return withParameter(`${field} ~ :${parameterName}`, parameterName, value);
  }

  return withParameter(`${field} REGEXP :${parameterName}`, parameterName, value);
}

function buildArrayOverlapClause(
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  assertSqlOperatorSupport(dialect, 'any', 'TypeORM adapter');
  return withParameter(`${field} && :${parameterName}`, parameterName, value);
}

function buildArrayContainsClause(
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  assertSqlOperatorSupport(dialect, 'all', 'TypeORM adapter');
  return withParameter(`${field} @> :${parameterName}`, parameterName, value);
}

function buildArraySizeClause(
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  assertSqlOperatorSupport(dialect, 'size', 'TypeORM adapter');
  return withParameter(`cardinality(${field}) = :${parameterName}`, parameterName, value);
}

function buildDatePartClause(
  part: 'year' | 'month' | 'day',
  field: string,
  value: unknown,
  parameterName: string,
  dialect: SqlDialect,
): TypeOrmWhereClause {
  switch (dialect) {
    case 'postgres':
      return buildPostgresDatePartClause(part, field, value, parameterName);
    case 'mysql':
      return buildMysqlDatePartClause(part, field, value, parameterName);
    case 'sqlite':
      return buildSqliteDatePartClause(part, field, value, parameterName);
    default:
      return assertNeverDialect(dialect);
  }
}

function buildPostgresDatePartClause(
  part: 'year' | 'month' | 'day',
  field: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  if (part === 'month') {
    return withParameter(`TO_CHAR(${field}, 'YYYY-MM') = :${parameterName}`, parameterName, value);
  }

  return withParameter(
    `EXTRACT(${part.toUpperCase()} FROM ${field}) = :${parameterName}`,
    parameterName,
    value,
  );
}

function buildMysqlDatePartClause(
  part: 'year' | 'month' | 'day',
  field: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  if (part === 'month') {
    return withParameter(
      `DATE_FORMAT(${field}, '%Y-%m') = :${parameterName}`,
      parameterName,
      value,
    );
  }

  const fn = part === 'year' ? 'YEAR' : 'DAY';
  return withParameter(`${fn}(${field}) = :${parameterName}`, parameterName, value);
}

function buildSqliteDatePartClause(
  part: 'year' | 'month' | 'day',
  field: string,
  value: unknown,
  parameterName: string,
): TypeOrmWhereClause {
  if (part === 'month') {
    return withParameter(
      `strftime('%Y-%m', ${field}) = :${parameterName}`,
      parameterName,
      value,
    );
  }

  const token = part === 'year' ? '%Y' : '%d';
  return withParameter(
    `CAST(strftime('${token}', ${field}) AS INTEGER) = :${parameterName}`,
    parameterName,
    value,
  );
}

function assertNeverDialect(dialect: never): never {
  throw new Error(`Unhandled SQL dialect "${dialect}"`);
}
