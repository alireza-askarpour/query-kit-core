import { Query } from './filter-format.interface';
import { FilterAuditResult } from './filter-diagnostics.interface';

export interface FilterPipelineOptions<
  TSchema = unknown,
  TValidationContext = unknown,
> {
  validate?: boolean;
  schema?: TSchema;
  validationContext?: TValidationContext;
}

export interface FilterProcessRequest<
  TAdapterOptions = unknown,
  TSchema = unknown,
  TValidationContext = unknown,
> {
  query: string | Query;
  formatName?: string;
  ormName?: string;
  adapterOptions?: TAdapterOptions;
  pipeline?: FilterPipelineOptions<TSchema, TValidationContext>;
}

export interface FilterRuntimeOptions {
  defaultFormat?: string;
  defaultOrm?: string;
  enableValidation?: boolean;
}

export interface FilterAuditor {
  audit<TQueryResult = unknown, TAdapterOptions = unknown>(
    query: string | Query,
    formatName: string,
    ormName: string,
    options?: TAdapterOptions,
  ): FilterAuditResult<TQueryResult>;
}
