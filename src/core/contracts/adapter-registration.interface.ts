import {
  FilterCapabilities,
  FilterMetadata,
} from './filter-capabilities.interface';
import { QueryAdapter } from './query-adapter.interface';

export interface AdapterCapabilities extends FilterCapabilities {}

export interface AdapterBundle<TAdapter extends QueryAdapter = QueryAdapter> {
  adapter: TAdapter;
  capabilities?: AdapterCapabilities;
  metadata?: FilterMetadata;
}
