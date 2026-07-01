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

export type RelationDirective =
  | string
  | Record<string, unknown>
  | Array<string | Record<string, unknown>>;

export interface FilterPredicate {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

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

export interface HavingCondition {
  operator: FilterOperator;
  value: unknown;
}

export interface AggregationExpression {
  field: string;
  operator: AggregationOperator;
  alias?: string;
  having?: HavingCondition;
}

export interface GroupByExpression {
  fields: string[];
  having?: HavingCondition;
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
  sorting?: SortInstruction[];
  pagination?: PaginationInstruction;
  projection?: ProjectionInstruction;
  relations?: RelationDirective;
  extensions?: FilterIrExtensions;
}

export interface NormalizedFilter extends FilterIR {
  conditions: FilterPredicate[];
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
  sorting?: SortInstruction[];
  pagination?: PaginationInstruction;
  projection?: ProjectionInstruction;
  relations?: RelationDirective;
  extensions?: FilterIrExtensions;
  customInclude?: RelationDirective;
}

export function createFilterIR(input: CreateFilterIrInput): NormalizedFilter {
  const predicates = input.predicates ?? [];
  const sorting = input.sorting;
  const pagination = input.pagination;
  const projection = input.projection;
  const relations = input.relations ?? input.customInclude;
  const sqlFeatures = input.extensions?.sql;

  return {
    predicates,
    sorting,
    pagination,
    projection,
    relations,
    extensions: input.extensions,
    conditions: predicates,
    sort: sorting,
    limit: pagination?.limit,
    page: pagination?.page,
    offset: pagination?.offset,
    fields: projection?.fields,
    relationLoad: relations,
    customInclude: input.customInclude ?? relations,
    caseExpressions: sqlFeatures?.caseExpressions,
    aggregations: sqlFeatures?.aggregations,
    groupBy: sqlFeatures?.groupBy,
    having: sqlFeatures?.having,
  };
}

export function getPredicates(filter: FilterIR | NormalizedFilter): FilterPredicate[] {
  return filter.predicates ?? (filter as NormalizedFilter).conditions ?? [];
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

export function getSqlFilterFeatures(
  filter: FilterIR | NormalizedFilter,
): SqlFilterFeatures {
  return (
    filter.extensions?.sql ?? {
      caseExpressions: (filter as NormalizedFilter).caseExpressions,
      aggregations: (filter as NormalizedFilter).aggregations,
      groupBy: (filter as NormalizedFilter).groupBy,
      having: (filter as NormalizedFilter).having,
    }
  );
}
