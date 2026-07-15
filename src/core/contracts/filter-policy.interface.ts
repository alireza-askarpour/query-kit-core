import type { FilterValidationIssue } from './filter-format-validator.interface';

export interface RegexComplexityPolicy {
  maxLength?: number;
  maxGroupCount?: number;
  maxAlternationCount?: number;
  maxQuantifierCount?: number;
  maxComplexityScore?: number;
  denyNestedQuantifiers?: boolean;
}

export interface FilterPolicyContext {
  role?: string;
  roles?: string[];
  isPublicEndpoint?: boolean;
  endpointVisibility?: 'public' | 'private' | (string & {});
  [key: string]: unknown;
}

export interface FilterPolicyOptions {
  maxExpressionDepth?: number;
  maxRelationDepth?: number;
  maxJoins?: number;
  maxPopulates?: number;
  maxArrayLength?: number;
  regex?: RegexComplexityPolicy;
  denyExpensiveOperatorsOnPublicEndpoints?: boolean;
  expensiveOperators?: string[];
}

export interface FilterPolicyEvaluationResult {
  errors: FilterValidationIssue[];
  warnings: FilterValidationIssue[];
}
