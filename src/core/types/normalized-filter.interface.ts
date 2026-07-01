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

export interface NormalizedCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface NormalizedSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface NormalizedCaseWhenThen {
  when: NormalizedCondition;
  then: unknown;
}

export interface NormalizedCaseExpression {
  outputField: string;
  cases: NormalizedCaseWhenThen[];
  elseValue?: unknown;
}

export type AggregationOperator = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregationExpression {
  field: string;
  operator: AggregationOperator;
  alias?: string;
  having?: HavingCondition;
}

export interface HavingCondition {
  operator: FilterOperator;
  value: unknown;
}

export interface GroupByExpression {
  fields: string[];
  having?: HavingCondition;
}

export interface NormalizedFilter {
  conditions: NormalizedCondition[];
  caseExpressions?: NormalizedCaseExpression[];
  sort?: NormalizedSort[];
  limit?: number;
  page?: number;
  offset?: number;
  fields?: string[];
  relationLoad?: RelationDirective;
  customInclude?: RelationDirective;
  aggregations?: AggregationExpression[];
  groupBy?: GroupByExpression;
  having?: HavingCondition;
}
