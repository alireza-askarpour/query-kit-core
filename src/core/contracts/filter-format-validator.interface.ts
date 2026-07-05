import { Query } from './filter-format.interface';

export interface FilterValidationIssue {
  field: string;
  operator?: string;
  value?: unknown;
  message: string;
  code: string;
}

export interface FilterValidationResult<TSanitized = unknown> {
  isValid: boolean;
  errors: FilterValidationIssue[];
  warnings: FilterValidationIssue[];
  sanitized?: TSanitized;
}

export interface FilterFormatValidator<TSchema = unknown, TSanitized = unknown> {
  formatName: string;
  validate(
    queryString: Query['filterString'],
    schema?: TSchema,
    context?: unknown,
  ): FilterValidationResult<TSanitized>;
}
