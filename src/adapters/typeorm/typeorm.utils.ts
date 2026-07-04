import {
  FilterIR,
  getPagination,
  getRelations,
  NormalizedCaseExpression,
  NormalizedSort,
} from '../../core';
import {
  TypeOrmAdapterOptions,
  TypeOrmJoinDefinition,
  TypeOrmQueryBuilderLike,
  TypeOrmWhereClause,
} from './typeorm.types';

export function resolveField<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  field: string,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): string {
  const mappedField = options.fieldMap?.[field] ?? field;

  if (mappedField.includes('.')) {
    return mappedField;
  }

  return `${options.rootAlias ?? 'entity'}.${mappedField}`;
}

export function createParameterName(field: string, operator: string): string {
  return `${field.replace(/[^a-zA-Z0-9]+/g, '_')}_${operator}`.replace(
    /^_+|_+$/g,
    '',
  );
}

export function createCaseParameterName(
  outputField: string,
  expressionIndex: number,
  caseIndex: number,
): string {
  return `${outputField.replace(/[^a-zA-Z0-9]+/g, '_')}_${expressionIndex}_${caseIndex}`;
}

export function getLimit(
  limit: number | undefined,
  options: TypeOrmAdapterOptions,
): number {
  const defaultLimit = options.defaultLimit ?? 100;
  const maxLimit = options.maxLimit ?? 1000;

  return Math.min(limit ?? defaultLimit, maxLimit);
}

export function getOffset(
  page: number | undefined,
  offset: number | undefined,
  limit: number,
): number {
  if (offset !== undefined) {
    return Math.max(0, offset);
  }

  if (!page || page <= 0) {
    return 0;
  }

  return (page - 1) * limit;
}

export function applySorting<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  sort: NormalizedSort[],
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  sort.forEach((item) => {
    queryBuilder.addOrderBy(
      resolveField(item.field, options),
      item.direction.toUpperCase() as 'ASC' | 'DESC',
    );
  });
}

export function applyPagination<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  normalized: FilterIR,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  const pagination = getPagination(normalized);
  const limit = getLimit(pagination.limit, options);
  const offset = getOffset(pagination.page, pagination.offset, limit);
  queryBuilder.take(limit);
  queryBuilder.skip(offset);
}

export function applyFieldSelection<
  TQueryBuilder extends TypeOrmQueryBuilderLike,
>(
  queryBuilder: TQueryBuilder,
  fields: string[] | undefined,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  if (!fields?.length) {
    return;
  }

  queryBuilder.select(fields.map((field) => resolveField(field, options)));
}

export function applyIncludes<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  include: ReturnType<typeof getRelations>,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  if (!include) {
    return;
  }

  const items = Array.isArray(include) ? include : [include];
  const joinedAliases = new Set<string>();

  items.forEach((item) => {
    if (typeof item !== 'string') {
      return;
    }

    const mappedJoin = options.includeMap?.[item];
    if (mappedJoin) {
      applyMappedJoin(queryBuilder, mappedJoin, joinedAliases);
      return;
    }

    applyIncludePath(
      queryBuilder,
      item,
      options.rootAlias ?? 'entity',
      joinedAliases,
    );
  });
}

export function applyCaseExpressions<
  TQueryBuilder extends TypeOrmQueryBuilderLike,
>(
  queryBuilder: TQueryBuilder,
  expressions: NormalizedCaseExpression[] | undefined,
  buildPredicate: (
    expression: NormalizedCaseExpression,
    expressionIndex: number,
  ) => string,
): void {
  if (!expressions?.length) {
    return;
  }

  expressions.forEach((expression, expressionIndex) => {
    queryBuilder.addSelect(
      `CASE ${buildPredicate(expression, expressionIndex)} END`,
      expression.outputField,
    );
  });
}

export function inlineCondition(
  input: TypeOrmWhereClause,
  escapeLiteral: (value: unknown) => string,
): string {
  if (!input.parameters) {
    return input.condition;
  }

  let expression = input.condition;

  Object.entries(input.parameters).forEach(([key, value]) => {
    const spreadReplacement = Array.isArray(value)
      ? value.map((item) => escapeLiteral(item)).join(', ')
      : escapeLiteral(value);
    const standardReplacement = Array.isArray(value)
      ? `(${spreadReplacement})`
      : escapeLiteral(value);

    expression = expression
      .replace(new RegExp(`:\\.\\.\\.${key}\\b`, 'g'), spreadReplacement)
      .replace(new RegExp(`:${key}\\b`, 'g'), standardReplacement);
  });

  return expression;
}

export function escapeLiteral(value: unknown): string {
  if (value === null) {
    return 'NULL';
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `ARRAY[${value.map((item) => escapeLiteral(item)).join(', ')}]`;
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function applyMappedJoin<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  join: TypeOrmJoinDefinition,
  joinedAliases: Set<string>,
): void {
  const alias = join.alias ?? defaultJoinAlias(join.path);

  if (joinedAliases.has(alias)) {
    return;
  }

  if (join.select === false) {
    queryBuilder.leftJoin(join.path, alias);
  } else {
    queryBuilder.leftJoinAndSelect(join.path, alias);
  }

  joinedAliases.add(alias);
}

function applyIncludePath<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  includePath: string,
  rootAlias: string,
  joinedAliases: Set<string>,
): void {
  const segments = includePath.split('.');
  let currentAlias = rootAlias;

  segments.forEach((segment) => {
    const nextAlias = `${currentAlias}_${segment}`;

    if (!joinedAliases.has(nextAlias)) {
      queryBuilder.leftJoinAndSelect(`${currentAlias}.${segment}`, nextAlias);
      joinedAliases.add(nextAlias);
    }

    currentAlias = nextAlias;
  });
}

function defaultJoinAlias(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '_');
}
