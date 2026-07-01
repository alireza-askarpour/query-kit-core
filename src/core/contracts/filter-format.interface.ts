import {
  NormalizedFilter,
  RelationDirective,
} from '../types/normalized-filter.interface';

export interface FilterFormat {
  name: string;
  parse(query: Query): NormalizedFilter;
  serialize?(filter: NormalizedFilter): string;
}

export type Query = {
  filterString: string;
  sortString?: string;
  page?: number;
  size?: number;
  offset?: number;
  fields?: string[];
  relations?: RelationDirective;
  customInclude?: RelationDirective;
};
