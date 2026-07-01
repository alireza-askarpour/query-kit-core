import { FilterIR } from '../types/normalized-filter.interface';

export interface QueryAdapter<TQueryBuilder = unknown, TOptions = unknown> {
  ormName: string;
  convert(
    normalized: FilterIR,
    options?: TOptions,
  ): Promise<TQueryBuilder> | TQueryBuilder;
}
