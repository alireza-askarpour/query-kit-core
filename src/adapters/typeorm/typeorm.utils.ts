import type {
  AggregateDefinition,
  AggregationExpression,
  FilterPredicate,
  FilterIR,
  getRelations,
  NormalizedCaseExpression,
  NormalizedSort,
  RelationDefinition} from '../../core';
import {
  getPagination,
  normalizeRelationDirectives
} from '../../core';
import type {
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

  const joinedAliases = new Set<string>();

  normalizeRelationDirectives(include).forEach((relation) => {
    applyRelationDefinition(
      queryBuilder,
      relation,
      options.rootAlias ?? 'entity',
      joinedAliases,
      options,
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

export function applyAggregations<
  TQueryBuilder extends TypeOrmQueryBuilderLike,
>(
  queryBuilder: TQueryBuilder,
  aggregation: AggregateDefinition | undefined,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
  buildMetricExpression: (metric: AggregationExpression) => string,
  buildHavingExpression?: (predicate: FilterPredicate) => string,
): void {
  if (!aggregation) {
    return;
  }

  const groupFields =
    aggregation.groupBy?.map((field) => resolveField(field, options)) ?? [];

  if (groupFields.length > 0) {
    queryBuilder.select(groupFields);
  }

  aggregation.metrics.forEach((metric) => {
    queryBuilder.addSelect(
      buildMetricExpression(metric),
      metric.alias ?? `${metric.operator}_${metric.field ?? 'all'}`,
    );
  });

  if (groupFields.length > 0 && queryBuilder.groupBy) {
    queryBuilder.groupBy(groupFields[0]);
    groupFields.slice(1).forEach((field) => {
      queryBuilder.addGroupBy?.(field);
    });
  }

  if (aggregation.having?.length && buildHavingExpression) {
    const [first, ...rest] = aggregation.having;
    queryBuilder.having?.(buildHavingExpression(first));
    rest.forEach((predicate) => {
      queryBuilder.andHaving?.(buildHavingExpression(predicate));
    });
  }
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

function applyRelationDefinition<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  relation: RelationDefinition,
  parentAlias: string,
  joinedAliases: Set<string>,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  const mappedJoin = options.includeMap?.[relation.path];

  if (mappedJoin) {
    applyMappedJoin(
      queryBuilder,
      {
        ...mappedJoin,
        fields: relation.fields ?? mappedJoin.fields,
        nested: relation.nested ?? mappedJoin.nested,
        required: relation.required ?? mappedJoin.required,
      },
      joinedAliases,
      options,
    );
    return;
  }

  applyIncludePath(queryBuilder, relation, parentAlias, joinedAliases, options);
}

function applyMappedJoin<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  join: TypeOrmJoinDefinition,
  joinedAliases: Set<string>,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  const alias = join.alias ?? defaultJoinAlias(join.path);

  if (!joinedAliases.has(alias)) {
    applyJoin(queryBuilder, join.path, alias, join, options.rootAlias ?? 'entity');
    joinedAliases.add(alias);
  }

  applyRelationFieldSelection(queryBuilder, alias, join.fields);
  normalizeRelationDirectives(join.nested).forEach((nested) => {
    applyRelationDefinition(queryBuilder, nested, alias, joinedAliases, options);
  });
}

function applyIncludePath<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  relation: RelationDefinition,
  rootAlias: string,
  joinedAliases: Set<string>,
  options: TypeOrmAdapterOptions<TQueryBuilder>,
): void {
  const segments = relation.path.split('.');
  let currentAlias = rootAlias;
  let currentJoinPath = '';
  let finalAlias = rootAlias;

  segments.forEach((segment, index) => {
    const joinPath = currentJoinPath ? `${currentJoinPath}.${segment}` : `${currentAlias}.${segment}`;
    const nextAlias = `${currentAlias}_${segment}`;

    if (!joinedAliases.has(nextAlias)) {
      applyJoin(
        queryBuilder,
        joinPath,
        nextAlias,
        {
          required: index === segments.length - 1 ? relation.required : false,
          select:
            index === segments.length - 1
              ? relation.fields?.length
                ? false
                : true
              : true,
        },
        rootAlias,
      );
      joinedAliases.add(nextAlias);
    }

    currentAlias = nextAlias;
    currentJoinPath = nextAlias;
    finalAlias = nextAlias;
  });

  applyRelationFieldSelection(queryBuilder, finalAlias, relation.fields);
  normalizeRelationDirectives(relation.nested).forEach((nested) => {
    applyRelationDefinition(queryBuilder, nested, finalAlias, joinedAliases, options);
  });
}

function applyJoin<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  path: string,
  alias: string,
  relation: Pick<TypeOrmJoinDefinition, 'required' | 'select'>,
  rootAlias: string,
): void {
  const joinPath = path.includes('.') ? path : `${rootAlias}.${path}`;
  const shouldSelect = relation.select !== false;

  if (relation.required) {
    if (shouldSelect) {
      if (!queryBuilder.innerJoinAndSelect) {
        throw new Error(
          'TypeORM query builder must expose innerJoinAndSelect() for required relations.',
        );
      }
      queryBuilder.innerJoinAndSelect?.(joinPath, alias);
      return;
    }

    if (!queryBuilder.innerJoin) {
      throw new Error(
        'TypeORM query builder must expose innerJoin() for required relations.',
      );
    }
    queryBuilder.innerJoin?.(joinPath, alias);
    return;
  }

  if (shouldSelect) {
    queryBuilder.leftJoinAndSelect(joinPath, alias);
    return;
  }

  queryBuilder.leftJoin(joinPath, alias);
}

function applyRelationFieldSelection<TQueryBuilder extends TypeOrmQueryBuilderLike>(
  queryBuilder: TQueryBuilder,
  alias: string,
  fields?: string[],
): void {
  if (!fields?.length) {
    return;
  }

  fields.forEach((field) => {
    queryBuilder.addSelect(`${alias}.${field}`);
  });
}

function defaultJoinAlias(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '_');
}
