import { Inject, Injectable, Optional } from '@nestjs/common';
import { FilterFormatValidator } from '../../core';
import {
  DEFAULT_VALIDATION_OPTIONS,
  OPERATOR_ALIASES,
} from './sc-format-validation.constants';
import { parseQueryString } from './sc-format-validation.parser';
import {
  getAllowedOperatorsForType,
  getValidOperatorsList,
  isValidOperator,
  mergeValidationOptions,
  validateDateFormat,
  validateFieldName,
  validateNestedField,
} from './sc-format-validation.schema';
import { securityCheck } from './sc-format-validation.security';
import type {
  ConditionValidationResult,
  FieldSchema,
  ParsedCondition,
  ParsedConditionInput,
  SanitizedCondition,
  ValidationError,
  ValidationOptions,
  ValidationResult,
} from './sc-format-validation.types';
import {
  parseValueByOperator,
  validateValueBySchema,
} from './sc-format-validation.value';

export type {
  FieldSchema,
  ValidationError,
  ValidationOptions,
  ValidationResult,
} from './sc-format-validation.types';

@Injectable()
export class SCFormatValidator
  implements FilterFormatValidator<Record<string, FieldSchema>, SanitizedCondition[]>
{
  formatName = 'scfilter';
  private readonly options: ValidationOptions;

  constructor(
    @Optional()
    @Inject('SC_FORMAT_VALIDATION_OPTIONS')
    options: ValidationOptions = {},
  ) {
    this.options = mergeValidationOptions(DEFAULT_VALIDATION_OPTIONS, options);
  }

  validate(
    queryString: string,
    schema?: Record<string, FieldSchema>,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    if (!queryString || queryString.trim() === '') {
      return this.createEmptyResult();
    }

    const conditions = parseQueryString(queryString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat,
    });

    if (conditions.length > (this.options.maxConditions ?? 50)) {
      errors.push({
        field: 'query',
        message: `Too many conditions. Maximum allowed: ${this.options.maxConditions}`,
        code: 'MAX_CONDITIONS_EXCEEDED',
      });
    }

    const sanitizedConditions: SanitizedCondition[] = [];

    conditions.forEach((condition, index) => {
      const result = this.validateCondition(condition, schema, index);
      errors.push(...result.errors);
      warnings.push(...result.warnings);

      if (result.isValid && this.isSanitizedCondition(result.sanitized)) {
        sanitizedConditions.push(result.sanitized);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedConditions,
      sanitized: sanitizedConditions,
    };
  }

  validateAndSanitize(
    queryString: string,
    schema?: Record<string, FieldSchema>,
  ): {
    valid: boolean;
    conditions: SanitizedCondition[];
    errors: ValidationError[];
    warnings: ValidationError[];
  } {
    const result = this.validate(queryString, schema);
    return {
      valid: result.isValid,
      conditions: result.sanitizedConditions,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  private validateCondition(
    condition: ParsedCondition,
    schema: Record<string, FieldSchema> | undefined,
    index: number,
  ): ConditionValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const sanitized = { ...condition };

    if ('error' in condition) {
      errors.push({
        field: condition.field || `condition[${index}]`,
        message: condition.error,
        code: 'PARSE_ERROR',
      });
      return { isValid: false, errors, warnings, sanitized };
    }

    const { field, operator, rawValue } = condition;

    if (schema && !schema[field] && this.options.strictMode) {
      errors.push({
        field,
        message: `Field '${field}' is not allowed in schema`,
        code: 'FIELD_NOT_ALLOWED',
      });
    }

    if (!validateFieldName(field)) {
      errors.push({
        field,
        message:
          `Invalid field name '${field}'. Only alphanumeric, dots, and underscores allowed`,
        code: 'INVALID_FIELD_NAME',
      });
    }

    if (field.includes('.')) {
      if (!this.options.allowNestedFields) {
        errors.push({
          field,
          message: 'Nested fields are not allowed',
          code: 'NESTED_FIELDS_NOT_ALLOWED',
        });
      }

      const nestedResult = validateNestedField(field, this.options);
      if (!nestedResult.isValid) {
        errors.push(...nestedResult.errors);
      }
    }

    const fieldSchema = schema?.[field];
    const allowedOperators =
      fieldSchema?.allowedOperators ||
      getAllowedOperatorsForType(fieldSchema?.type);

    if (!isValidOperator(operator)) {
      errors.push({
        field,
        operator,
        message: `Invalid operator '${operator}'. Valid operators: ${getValidOperatorsList()}`,
        code: 'INVALID_OPERATOR',
      });
    } else if (allowedOperators && !allowedOperators.includes(operator)) {
      errors.push({
        field,
        operator,
        message: `Operator '${operator}' is not allowed for field '${field}'. Allowed: ${allowedOperators.join(', ')}`,
        code: 'OPERATOR_NOT_ALLOWED_FOR_FIELD',
      });
    }

    let parsedValue: unknown;
    try {
      parsedValue = parseValueByOperator(rawValue, operator, fieldSchema, {
        normalizeOperator: this.normalizeOperator.bind(this),
        validateDateFormat,
      });
      (sanitized as ParsedConditionInput).value = parsedValue;
    } catch (error) {
      errors.push({
        field,
        operator,
        value: rawValue,
        message: error instanceof Error ? error.message : String(error),
        code: 'VALUE_PARSE_ERROR',
      });
    }

    if (fieldSchema && parsedValue !== undefined) {
      const schemaValidation = validateValueBySchema(
        field,
        parsedValue,
        fieldSchema,
        operator,
      );
      errors.push(...schemaValidation.errors);
      warnings.push(...schemaValidation.warnings);
    }

    if (
      typeof rawValue === 'string' &&
      rawValue.length > (this.options.maxValueLength ?? 1000)
    ) {
      errors.push({
        field,
        operator,
        value: rawValue,
        message: `Value too long. Maximum length: ${this.options.maxValueLength}`,
        code: 'VALUE_TOO_LONG',
      });
    }

    const securityResult = securityCheck(rawValue);
    if (!securityResult.isValid) {
      errors.push({
        field,
        operator,
        value: rawValue,
        message: securityResult.message ?? 'Security violation detected',
        code: 'SECURITY_VIOLATION',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  private normalizeOperator(operator: string): string {
    return OPERATOR_ALIASES[operator.toLowerCase()] ?? operator;
  }

  private createEmptyResult(): ValidationResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      sanitizedConditions: [],
      sanitized: [],
    };
  }

  private isSanitizedCondition(
    condition: ParsedCondition,
  ): condition is SanitizedCondition {
    return 'field' in condition && 'rawValue' in condition && 'operator' in condition;
  }
}
