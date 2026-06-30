import { Query } from './filter-format.interface';

export interface FilterPipelineOptions<TSchema = unknown> {
  validate?: boolean;
  schema?: TSchema;
}

export interface FilterProcessRequest<
  TAdapterOptions = unknown,
  TSchema = unknown,
> {
  query: string | Query;
  formatName?: string;
  ormName?: string;
  adapterOptions?: TAdapterOptions;
  pipeline?: FilterPipelineOptions<TSchema>;
}

export interface FilterRuntimeOptions {
  defaultFormat?: string;
  defaultOrm?: string;
  enableValidation?: boolean;
}

