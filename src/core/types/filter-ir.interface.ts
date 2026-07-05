export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'like'
  | 'iLike'
  | 'notLike'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'in'
  | 'notIn'
  | 'any'
  | 'all'
  | 'size'
  | 'isNull'
  | 'isNotNull'
  | 'exists'
  | 'notExists'
  | 'date'
  | 'year'
  | 'month'
  | 'day'
  | 'elemMatch';

export interface RelationDefinition {
  path: string;
  fields?: string[];
  nested?: RelationDirective;
  required?: boolean;
}

export type RelationDirective =
  | string
  | RelationDefinition
  | Array<string | RelationDefinition>;

export interface FilterPredicate {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface FilterPredicateNode {
  kind: 'predicate';
  predicate: FilterPredicate;
}

export interface FilterLogicalGroupNode {
  kind: 'group';
  operator: 'and' | 'or';
  children: FilterExpressionNode[];
}

export interface FilterNotNode {
  kind: 'not';
  child: FilterExpressionNode;
}

export type FilterExpressionNode =
  | FilterPredicateNode
  | FilterLogicalGroupNode
  | FilterNotNode;

export interface SortInstruction {
  field: string;
  direction: 'asc' | 'desc';
}

export interface PaginationInstruction {
  limit?: number;
  page?: number;
  offset?: number;
}

export interface ProjectionInstruction {
  fields: string[];
}

export interface FilterCaseWhenThen {
  when: FilterPredicate;
  then: unknown;
}

export interface FilterCaseExpression {
  outputField: string;
  cases: FilterCaseWhenThen[];
  elseValue?: unknown;
}

export type AggregationOperator = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregationExpression {
  field?: string;
  operator: AggregationOperator;
  alias?: string;
  distinct?: boolean;
}

export interface GroupByExpression {
  fields: string[];
}

export interface AggregateDefinition {
  metrics: AggregationExpression[];
  groupBy?: string[];
  having?: FilterPredicate[];
}

export interface HavingCondition {
  field?: string;
  operator: FilterOperator;
  value: unknown;
}

export interface SqlFilterFeatures {
  caseExpressions?: FilterCaseExpression[];
  aggregations?: AggregationExpression[];
  groupBy?: GroupByExpression;
  having?: HavingCondition;
}

export interface DocumentFilterFeatures {
  populate?: RelationDirective;
}

export interface FilterIrExtensions {
  sql?: SqlFilterFeatures;
  document?: DocumentFilterFeatures;
  [extensionKey: string]: unknown;
}

export interface FilterIR {
  predicates: FilterPredicate[];
  expression?: FilterExpressionNode;
  aggregation?: AggregateDefinition;
  sorting?: SortInstruction[];
  pagination?: PaginationInstruction;
  projection?: ProjectionInstruction;
  relations?: RelationDirective;
  extensions?: FilterIrExtensions;
}

export interface NormalizedFilter extends FilterIR {
  conditions: FilterPredicate[];
  logicalExpression?: FilterExpressionNode;
  aggregate?: AggregateDefinition;
  sort?: SortInstruction[];
  limit?: number;
  page?: number;
  offset?: number;
  fields?: string[];
  relationLoad?: RelationDirective;
  customInclude?: RelationDirective;
  caseExpressions?: FilterCaseExpression[];
  aggregations?: AggregationExpression[];
  groupBy?: GroupByExpression;
  having?: HavingCondition;
}

export type NormalizedCondition = FilterPredicate;
export type NormalizedSort = SortInstruction;
export type NormalizedCaseWhenThen = FilterCaseWhenThen;
export type NormalizedCaseExpression = FilterCaseExpression;

export interface CreateFilterIrInput {
  predicates?: FilterPredicate[];
  expression?: FilterExpressionNode;
  aggregation?: AggregateDefinition;
  sorting?: SortInstruction[];
  pagination?: PaginationInstruction;
  projection?: ProjectionInstruction;
  relations?: RelationDirective;
  extensions?: FilterIrExtensions;
  customInclude?: RelationDirective;
}

export interface FilterCapabilityRequirements {
  requiresRegex: boolean;
  requiresArrayOperators: boolean;
  requiresCaseExpressions: boolean;
  requiresAggregations: boolean;
}

export function createFilterIR(input: CreateFilterIrInput): NormalizedFilter {
  const predicates = input.predicates ?? [];
  const expression = input.expression;
  const aggregation =
    input.aggregation ?? normalizeLegacyAggregation(input.extensions?.sql);
  const sorting = input.sorting;
  const pagination = input.pagination;
  const projection = input.projection;
  const relations = input.relations ?? input.customInclude;
  const sqlFeatures = input.extensions?.sql;

  return {
    predicates,
    expression,
    aggregation,
    sorting,
    pagination,
    projection,
    relations,
    extensions: input.extensions,
    conditions: predicates,
    logicalExpression: expression,
    aggregate: aggregation,
    sort: sorting,
    limit: pagination?.limit,
    page: pagination?.page,
    offset: pagination?.offset,
    fields: projection?.fields,
    relationLoad: relations,
    customInclude: input.customInclude ?? relations,
    caseExpressions: sqlFeatures?.caseExpressions,
    aggregations: aggregation?.metrics ?? sqlFeatures?.aggregations,
    groupBy: aggregation?.groupBy
      ? { fields: aggregation.groupBy }
      : sqlFeatures?.groupBy,
    having: aggregation?.having?.[0]
      ? {
          field: aggregation.having[0].field,
          operator: aggregation.having[0].operator,
          value: aggregation.having[0].value,
        }
      : sqlFeatures?.having,
  };
}

export function createPredicateNode(predicate: FilterPredicate): FilterPredicateNode {
  return { kind: 'predicate', predicate };
}

export function createLogicalGroupNode(
  operator: 'and' | 'or',
  children: FilterExpressionNode[],
): FilterLogicalGroupNode {
  return { kind: 'group', operator, children };
}

export function createNotNode(child: FilterExpressionNode): FilterNotNode {
  return { kind: 'not', child };
}

export function getPredicates(filter: FilterIR | NormalizedFilter): FilterPredicate[] {
  const directPredicates = filter.predicates ?? (filter as NormalizedFilter).conditions;
  if (directPredicates?.length) {
    return directPredicates;
  }

  const expression = getFilterExpression(filter);
  if (!expression) {
    return [];
  }

  return collectPredicates(expression);
}

export function getSorting(filter: FilterIR | NormalizedFilter): SortInstruction[] {
  return filter.sorting ?? (filter as NormalizedFilter).sort ?? [];
}

export function getPagination(
  filter: FilterIR | NormalizedFilter,
): PaginationInstruction {
  return (
    filter.pagination ?? {
      limit: (filter as NormalizedFilter).limit,
      page: (filter as NormalizedFilter).page,
      offset: (filter as NormalizedFilter).offset,
    }
  );
}

export function getProjectionFields(
  filter: FilterIR | NormalizedFilter,
): string[] | undefined {
  return filter.projection?.fields ?? (filter as NormalizedFilter).fields;
}

export function getRelations(
  filter: FilterIR | NormalizedFilter,
): RelationDirective | undefined {
  return (
    filter.relations ??
    (filter as NormalizedFilter).relationLoad ??
    (filter as NormalizedFilter).customInclude
  );
}

export function normalizeRelationDirectives(
  relations: RelationDirective | undefined,
): RelationDefinition[] {
  if (!relations) {
    return [];
  }

  const items = Array.isArray(relations) ? relations : [relations];

  return items.map((item) => normalizeRelationDirective(item));
}

export function getSqlFilterFeatures(
  filter: FilterIR | NormalizedFilter,
): SqlFilterFeatures {
  const aggregate = getAggregationDefinition(filter);

  return (
    filter.extensions?.sql ?? {
      caseExpressions: (filter as NormalizedFilter).caseExpressions,
      aggregations: aggregate?.metrics ?? (filter as NormalizedFilter).aggregations,
      groupBy:
        aggregate?.groupBy
          ? { fields: aggregate.groupBy }
          : (filter as NormalizedFilter).groupBy,
      having:
        aggregate?.having?.[0]
          ? {
              field: aggregate.having[0].field,
              operator: aggregate.having[0].operator,
              value: aggregate.having[0].value,
            }
          : (filter as NormalizedFilter).having,
    }
  );
}

export function getAggregationDefinition(
  filter: FilterIR | NormalizedFilter,
): AggregateDefinition | undefined {
  if (filter.aggregation) {
    return filter.aggregation;
  }

  if ((filter as NormalizedFilter).aggregate) {
    return (filter as NormalizedFilter).aggregate;
  }

  return normalizeLegacyAggregation(filter.extensions?.sql ?? {
    aggregations: (filter as NormalizedFilter).aggregations,
    groupBy: (filter as NormalizedFilter).groupBy,
    having: (filter as NormalizedFilter).having,
  });
}

export function getFilterExpression(
  filter: FilterIR | NormalizedFilter,
): FilterExpressionNode | undefined {
  return filter.expression ?? (filter as NormalizedFilter).logicalExpression;
}

export function hasComplexLogicalExpression(
  filter: FilterIR | NormalizedFilter,
): boolean {
  const expression = getFilterExpression(filter);
  if (!expression) {
    return false;
  }

  return expression.kind !== 'predicate';
}

export function getCapabilityRequirements(
  filter: FilterIR | NormalizedFilter,
): FilterCapabilityRequirements {
  const sqlFeatures = getSqlFilterFeatures(filter);
  const aggregation = getAggregationDefinition(filter);
  const predicates = [
    ...getPredicates(filter),
    ...(sqlFeatures.caseExpressions ?? []).flatMap((expression) =>
      expression.cases.map((entry) => entry.when),
    ),
    ...(aggregation?.having ?? []),
  ];

  return {
    requiresRegex: predicates.some((predicate) => predicate.operator === 'regex'),
    requiresArrayOperators: predicates.some((predicate) =>
      ARRAY_OPERATORS_FOR_CAPABILITIES.has(predicate.operator),
    ),
    requiresCaseExpressions: Boolean(sqlFeatures.caseExpressions?.length),
    requiresAggregations: Boolean(
      aggregation?.metrics.length ||
        aggregation?.groupBy?.length ||
        aggregation?.having?.length ||
        sqlFeatures.aggregations?.length ||
        sqlFeatures.groupBy ||
        sqlFeatures.having,
    ),
  };
}

function collectPredicates(expression: FilterExpressionNode): FilterPredicate[] {
  switch (expression.kind) {
    case 'predicate':
      return [expression.predicate];
    case 'not':
      return collectPredicates(expression.child);
    case 'group':
      return expression.children.flatMap((child) => collectPredicates(child));
    default:
      return assertNeverExpression(expression);
  }
}

function normalizeRelationDirective(
  relation: string | RelationDefinition,
): RelationDefinition {
  if (typeof relation === 'string') {
    return { path: relation };
  }

  return {
    path: relation.path,
    fields: relation.fields?.length ? [...relation.fields] : undefined,
    nested: relation.nested
      ? normalizeRelationDirectives(relation.nested)
      : undefined,
    required: relation.required,
  };
}

function assertNeverExpression(expression: never): never {
  throw new Error(`Unhandled filter expression node: ${JSON.stringify(expression)}`);
}

const ARRAY_OPERATORS_FOR_CAPABILITIES = new Set<FilterOperator>([
  'in',
  'notIn',
  'any',
  'all',
  'size',
  'elemMatch',
]);

function normalizeLegacyAggregation(
  sqlFeatures: SqlFilterFeatures | undefined,
): AggregateDefinition | undefined {
  if (!sqlFeatures) {
    return undefined;
  }

  const metrics = sqlFeatures.aggregations ?? [];
  const groupBy = sqlFeatures.groupBy?.fields;
  const having = sqlFeatures.having?.field
    ? [
        {
          field: sqlFeatures.having.field,
          operator: sqlFeatures.having.operator,
          value: sqlFeatures.having.value,
        },
      ]
    : undefined;

  if (metrics.length === 0 && !groupBy?.length && !having?.length) {
    return undefined;
  }

  return {
    metrics,
    groupBy,
    having,
  };
}
