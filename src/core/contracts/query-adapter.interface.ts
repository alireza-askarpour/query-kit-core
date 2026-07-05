import { FilterIR } from '../types/normalized-filter.interface';
import { AdapterStrategyDiagnostic } from './filter-diagnostics.interface';
import {
  FilterCapabilities,
  FilterMetadata,
} from './filter-capabilities.interface';

export interface QueryAdapter<TQueryBuilder = unknown, TOptions = unknown> {
  ormName: string;
  capabilities?: FilterCapabilities;
  metadata?: FilterMetadata;
  convert(
    normalized: FilterIR,
    options?: TOptions,
  ): Promise<TQueryBuilder> | TQueryBuilder;
  describeStrategy?(
    normalized: FilterIR,
    options?: TOptions,
  ): AdapterStrategyDiagnostic;
}
