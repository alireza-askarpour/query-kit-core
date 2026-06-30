import { NormalizedFilter } from '../types/normalized-filter.interface';

export interface QueryAdapter<TQueryBuilder = unknown, TOptions = unknown> {
  ormName: string;
  convert(
    normalized: NormalizedFilter,
    options?: TOptions,
  ): Promise<TQueryBuilder> | TQueryBuilder;
}
