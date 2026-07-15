import type { Query } from './filter-format.interface';
import type { FilterAuditResult } from './filter-diagnostics.interface';
import type { FilterPolicyContext, FilterPolicyOptions } from './filter-policy.interface';

export interface FilterPipelineOptions<
  TSchema = unknown,
  TValidationContext = FilterPolicyContext,
> {
  validate?: boolean;
  schema?: TSchema;
  validationContext?: TValidationContext;
  policy?: FilterPolicyOptions;
}

export interface FilterProcessRequest<
  TAdapterOptions = unknown,
  TSchema = unknown,
  TValidationContext = FilterPolicyContext,
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
  policy?: FilterPolicyOptions;
}

export interface FilterAuditor {
  audit<TQueryResult = unknown, TAdapterOptions = unknown>(
    query: string | Query,
    formatName: string,
    ormName: string,
    options?: TAdapterOptions,
  ): FilterAuditResult<TQueryResult>;
}
