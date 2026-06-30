import { QueryAdapter } from './query-adapter.interface';

export interface AdapterCapabilities {
  supportsCaseExpressions?: boolean;
  supportsFieldSelection?: boolean;
  supportsIncludes?: boolean;
  supportsPagination?: boolean;
  supportsSorting?: boolean;
}

export interface AdapterBundle<TAdapter extends QueryAdapter = QueryAdapter> {
  adapter: TAdapter;
  capabilities?: AdapterCapabilities;
  metadata?: Record<string, unknown>;
}

