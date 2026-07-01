import { NormalizedCondition } from '../../core';
import {
  TypeOrmClauseBuilderDependencies,
  TypeOrmOperatorHandler,
  TypeOrmWhereClause,
} from './typeorm.types';

export function createTypeOrmOperatorHandlers(
  _dependencies: TypeOrmClauseBuilderDependencies,
): Record<NormalizedCondition['operator'], TypeOrmOperatorHandler> {
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
      withParameter(`${field} ILIKE :${parameterName}`, parameterName, value),
    notLike: (field, value, parameterName) =>
      withParameter(`${field} NOT LIKE :${parameterName}`, parameterName, value),
    contains: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `%${String(value)}%`),
    startsWith: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `${String(value)}%`),
    endsWith: (field, value, parameterName) =>
      withParameter(`${field} LIKE :${parameterName}`, parameterName, `%${String(value)}`),
    regex: (field, value, parameterName) =>
      withParameter(`${field} ~ :${parameterName}`, parameterName, value),
    in: (field, value, parameterName) =>
      buildArrayMembershipClause(`${field} IN (:...${parameterName})`, value, parameterName),
    notIn: (field, value, parameterName) =>
      buildArrayMembershipClause(`${field} NOT IN (:...${parameterName})`, value, parameterName),
    any: (field, value, parameterName) =>
      withParameter(`${field} && :${parameterName}`, parameterName, value),
    all: (field, value, parameterName) =>
      withParameter(`${field} @> :${parameterName}`, parameterName, value),
    size: (field, value, parameterName) =>
      withParameter(`cardinality(${field}) = :${parameterName}`, parameterName, value),
    isNull: (field, value) => ({ condition: `${field} ${value ? 'IS NULL' : 'IS NOT NULL'}` }),
    isNotNull: (field, value) => ({ condition: `${field} ${value ? 'IS NOT NULL' : 'IS NULL'}` }),
    exists: (field, value) => ({ condition: `${field} ${value ? 'IS NOT NULL' : 'IS NULL'}` }),
    notExists: (field, value) => ({ condition: `${field} ${value ? 'IS NULL' : 'IS NOT NULL'}` }),
    date: (field, value, parameterName) => buildDateClause(field, value, parameterName),
    year: (field, value, parameterName) =>
      withParameter(`EXTRACT(YEAR FROM ${field}) = :${parameterName}`, parameterName, value),
    month: (field, value, parameterName) =>
      withParameter(`TO_CHAR(${field}, 'YYYY-MM') = :${parameterName}`, parameterName, value),
    day: (field, value, parameterName) =>
      withParameter(`EXTRACT(DAY FROM ${field}) = :${parameterName}`, parameterName, value),
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
