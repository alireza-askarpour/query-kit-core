export interface FilterCapabilities {
  supportsRegex?: boolean;
  supportsArrayOperators?: boolean;
  supportsCaseExpressions?: boolean;
  supportsAggregations?: boolean;
  supportsFieldSelection?: boolean;
  supportsIncludes?: boolean;
  supportsPagination?: boolean;
  supportsSorting?: boolean;
}

export interface FilterMetadata {
  [key: string]: unknown;
}
