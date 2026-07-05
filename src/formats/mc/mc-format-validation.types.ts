import {
  FilterValidationIssue,
  FilterValidationResult,
} from '../../core';
import {
  RoleAccessPolicy,
  RoleFieldAccessPolicy,
  ValidationContext,
  ValidationHook,
  ValueTransformer,
} from '../validation-policy.utils';

export interface MongoFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  allowedOperators?: string[];
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  nestedFields?: Record<string, MongoFieldSchema>;
  transform?: ValueTransformer<MongoFieldSchema>;
  validate?: ValidationHook<MongoFieldSchema>;
  access?: RoleAccessPolicy;
}

export interface MongoValidationOptions {
  allowedFields?: Record<string, MongoFieldSchema>;
  fieldWhitelist?: string[];
  fieldBlacklist?: string[];
  roleFieldAccess?: Record<string, RoleFieldAccessPolicy>;
  validationContext?: ValidationContext;
  customValidator?: ValidationHook<MongoFieldSchema>;
  maxConditions?: number;
  maxValueLength?: number;
  allowNestedFields?: boolean;
  strictMode?: boolean;
  allowObjectOperators?: boolean;
}

export interface MongoValidationResult
  extends FilterValidationResult<MongoSanitizedCondition[]> {
  sanitizedConditions: MongoSanitizedCondition[];
}

export interface MongoValidationError extends FilterValidationIssue {}

export interface MongoParsedConditionInput {
  field: string;
  operator: string;
  rawValue: string;
  value: unknown;
}

export interface MongoParsedConditionError {
  raw: string;
  error: string;
  field?: string;
}

export type MongoParsedCondition =
  | MongoParsedConditionInput
  | MongoParsedConditionError;

export interface MongoSanitizedCondition extends MongoParsedConditionInput {}

export interface MongoConditionValidationResult {
  isValid: boolean;
  errors: MongoValidationError[];
  warnings: MongoValidationError[];
  sanitized: MongoSanitizedCondition | MongoParsedCondition;
}

export interface MongoValidationDependencies {
  normalizeOperator(operator: string): string;
  validateDateFormat(dateString: string): void;
  parseObjectLiteral(rawValue: string): Record<string, unknown>;
}
