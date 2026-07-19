export type Primitive = string | number | boolean | null;
export type QueryValue = Primitive | Date;
export type ListValue = QueryValue[];

export type SCOperator =
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
  | 'day';

export type MCOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'all'
  | 'regex'
  | 'exists'
  | 'size'
  | 'elemMatch'
  | `$${'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'all' | 'regex' | 'exists' | 'size' | 'elemMatch'}`;

export type SortDirection = 'asc' | 'desc';

export interface SortDefinition {
  field: string;
  direction: SortDirection;
}

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

export interface QueryPayload {
  filterString: string;
  sortString?: string;
  page?: number;
  size?: number;
  offset?: number;
  fields?: string[];
  relations?: RelationDirective;
  customInclude?: RelationDirective;
}

export interface URLSearchParamsOptions {
  filterKey?: string;
  sortKey?: string;
  pageKey?: string;
  sizeKey?: string;
  offsetKey?: string;
  fieldsKey?: string;
  includeKey?: string;
  relationSerializer?: (relations: RelationDirective) => string;
}

export interface PayloadBuildOptions {
  inlineSort?: boolean;
  inlinePagination?: boolean;
  inlineFields?: boolean;
  inlineRelations?: boolean;
}

export interface AggregateMetric {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field: string;
  alias: string;
}

export interface CaseWhenDefinition {
  field: string;
  operator: SCOperator;
  value: QueryValue | ListValue;
  result: QueryValue;
}
