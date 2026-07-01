import { NormalizedCondition } from '../core';

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

export type SqlOperator = NormalizedCondition['operator'];

type SqlCapabilityMatrix = Record<SqlOperator, readonly SqlDialect[]>;

export const SQL_DIALECT_OPERATOR_SUPPORT: SqlCapabilityMatrix = {
  eq: ['postgres', 'mysql', 'sqlite'],
  neq: ['postgres', 'mysql', 'sqlite'],
  gt: ['postgres', 'mysql', 'sqlite'],
  gte: ['postgres', 'mysql', 'sqlite'],
  lt: ['postgres', 'mysql', 'sqlite'],
  lte: ['postgres', 'mysql', 'sqlite'],
  between: ['postgres', 'mysql', 'sqlite'],
  like: ['postgres', 'mysql', 'sqlite'],
  iLike: ['postgres', 'mysql', 'sqlite'],
  notLike: ['postgres', 'mysql', 'sqlite'],
  contains: ['postgres', 'mysql', 'sqlite'],
  startsWith: ['postgres', 'mysql', 'sqlite'],
  endsWith: ['postgres', 'mysql', 'sqlite'],
  regex: ['postgres', 'mysql'],
  in: ['postgres', 'mysql', 'sqlite'],
  notIn: ['postgres', 'mysql', 'sqlite'],
  any: ['postgres'],
  all: ['postgres'],
  size: ['postgres'],
  isNull: ['postgres', 'mysql', 'sqlite'],
  isNotNull: ['postgres', 'mysql', 'sqlite'],
  exists: ['postgres', 'mysql', 'sqlite'],
  notExists: ['postgres', 'mysql', 'sqlite'],
  date: ['postgres', 'mysql', 'sqlite'],
  year: ['postgres', 'mysql', 'sqlite'],
  month: ['postgres', 'mysql', 'sqlite'],
  day: ['postgres', 'mysql', 'sqlite'],
  elemMatch: [],
};

export function supportsSqlOperator(
  dialect: SqlDialect,
  operator: SqlOperator,
): boolean {
  return SQL_DIALECT_OPERATOR_SUPPORT[operator].includes(dialect);
}

export function assertSqlOperatorSupport(
  dialect: SqlDialect,
  operator: SqlOperator,
  adapterName: string,
): void {
  if (supportsSqlOperator(dialect, operator)) {
    return;
  }

  throw new Error(
    `Operator "${operator}" is not supported by ${adapterName} for SQL dialect "${dialect}"`,
  );
}

export function normalizeSequelizeDialect(rawDialect: string): SqlDialect {
  switch (rawDialect) {
    case 'postgres':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
      return 'sqlite';
    case 'mssql':
      throw new Error(
        'Sequelize SQL dialect "mssql" is intentionally not supported by this package',
      );
    default:
      throw new Error(
        `Unsupported Sequelize SQL dialect "${rawDialect}". Supported dialects: postgres, mysql, sqlite`,
      );
  }
}
