import {
  FilterValidationIssue,
  FilterValidationResult,
} from '../../core';

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  allowedOperators?: string[];
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  nestedFields?: Record<string, FieldSchema>;
  relations?: string[];
}

export interface ValidationOptions {
  allowedFields?: Record<string, FieldSchema>;
  maxConditions?: number;
  maxValueLength?: number;
  allowNestedFields?: boolean;
  allowRelations?: boolean;
  strictMode?: boolean;
}

export interface ValidationResult
  extends FilterValidationResult<SanitizedCondition[]> {
  sanitizedConditions: SanitizedCondition[];
}

export interface ValidationError extends FilterValidationIssue {}

export interface ParsedConditionInput {
  field: string;
  operator: string;
  rawValue: string;
  value: unknown;
}

export interface ParsedConditionError {
  raw: string;
  error: string;
  field?: string;
}

export type ParsedCondition = ParsedConditionInput | ParsedConditionError;

export interface SanitizedCondition extends ParsedConditionInput {}

export interface ConditionValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  sanitized: SanitizedCondition | ParsedCondition;
}

export interface ValidationDependencies {
  normalizeOperator(operator: string): string;
  validateDateFormat(dateString: string): void;
}
