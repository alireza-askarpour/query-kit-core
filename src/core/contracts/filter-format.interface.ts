import type {
  FilterIR,
  RelationDirective,
} from '../types/normalized-filter.interface';
import type {
  FilterCapabilities,
  FilterMetadata,
} from './filter-capabilities.interface';

export interface FilterFormat {
  name: string;
  capabilities?: FilterCapabilities;
  metadata?: FilterMetadata;
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
