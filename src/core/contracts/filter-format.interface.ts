import {
  FilterIR,
  RelationDirective,
} from '../types/normalized-filter.interface';

export interface FilterFormat {
  name: string;
  parse(query: Query): FilterIR;
  serialize?(filter: FilterIR): string;
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
