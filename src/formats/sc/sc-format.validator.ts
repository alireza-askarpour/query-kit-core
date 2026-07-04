import { Inject, Injectable, Optional } from '@nestjs/common';
import { FilterFormatValidator } from '../../core';
import {
  DEFAULT_VALIDATION_OPTIONS,
  OPERATOR_ALIASES,
} from './sc-format-validation.constants';
import { parseQueryString } from './sc-format-validation.parser';
import { splitTopLevelSegments } from './sc-logical-expression.parser';
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
import {
  parseAggregationDirective,
  parseGroupByDirective,
} from '../aggregation-directive.utils';
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
    const aggregationValidation = this.validateAggregationDirectives(
      queryString,
      schema,
    );
    errors.push(...aggregationValidation.errors);
    warnings.push(...aggregationValidation.warnings);

    if (
      conditions.length + aggregationValidation.havingConditionCount >
      (this.options.maxConditions ?? 50)
    ) {
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

  private validateAggregationDirectives(
    queryString: string,
    schema?: Record<string, FieldSchema>,
  ): {
    errors: ValidationError[];
    warnings: ValidationError[];
    havingConditionCount: number;
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const metrics: Array<{ field?: string; operator: string; alias?: string }> = [];
    const groupByFields: string[] = [];
    const rawHavingConditions: string[] = [];

    let parts: string[];
    try {
      parts = splitTopLevelSegments(queryString).filter(Boolean);
    } catch {
      return { errors, warnings, havingConditionCount: 0 };
    }

    parts.forEach((part) => {
      if (!part.startsWith('@')) {
        return;
      }

      const [rawDirective, ...rawValueParts] = part.split(/(?<!\\):/);
      const directive = rawDirective.slice(1).trim().toLowerCase();
      const value = rawValueParts.join(':').trim();

      try {
        switch (directive) {
          case 'aggregate':
            metrics.push(
              ...parseAggregationDirective(
                value,
                this.parseDirectiveList,
                '@aggregate',
              ),
            );
            break;
          case 'groupby':
            groupByFields.push(
              ...parseGroupByDirective(
                value,
                this.parseDirectiveList,
                '@groupBy',
              ),
            );
            break;
          case 'having':
            rawHavingConditions.push(value);
            break;
          default:
            break;
        }
      } catch (error) {
        errors.push({
          field: rawDirective,
          message: error instanceof Error ? error.message : String(error),
          code: 'AGGREGATION_DIRECTIVE_ERROR',
        });
      }
    });

    groupByFields.forEach((field) => {
      this.validateAggregationFieldReference(field, schema, errors);
    });

    metrics.forEach((metric) => {
      if (metric.field) {
        this.validateAggregationFieldReference(metric.field, schema, errors);
      }

      const fieldSchema = metric.field ? schema?.[metric.field] : undefined;
      if (
        (metric.operator === 'sum' || metric.operator === 'avg') &&
        fieldSchema &&
        fieldSchema.type !== 'number'
      ) {
        errors.push({
          field: metric.field ?? metric.alias ?? metric.operator,
          operator: metric.operator,
          message: `Aggregation operator '${metric.operator}' requires a numeric field`,
          code: 'INVALID_AGGREGATION_FIELD_TYPE',
        });
      }
    });

    const havingSchema = this.createHavingSchema(schema, groupByFields, metrics);

    rawHavingConditions.forEach((rawHaving, index) => {
      const parsed = this.parseDirectiveCondition(rawHaving);
      const result = this.validateCondition(parsed, havingSchema, index);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });

    return {
      errors,
      warnings,
      havingConditionCount: rawHavingConditions.length,
    };
  }

  private validateAggregationFieldReference(
    field: string,
    schema: Record<string, FieldSchema> | undefined,
    errors: ValidationError[],
  ): void {
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
      return;
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
  }

  private createHavingSchema(
    schema: Record<string, FieldSchema> | undefined,
    groupByFields: string[],
    metrics: Array<{ field?: string; operator: string; alias?: string }>,
  ): Record<string, FieldSchema> | undefined {
    if (!schema && metrics.length === 0 && groupByFields.length === 0) {
      return undefined;
    }

    const derivedSchema: Record<string, FieldSchema> = { ...(schema ?? {}) };

    groupByFields.forEach((field) => {
      derivedSchema[field] = schema?.[field] ?? { type: 'string' };
    });

    metrics.forEach((metric) => {
      const alias = metric.alias ?? `${metric.operator}_${metric.field ?? 'all'}`;
      const sourceSchema = metric.field ? schema?.[metric.field] : undefined;
      derivedSchema[alias] = {
        type:
          metric.operator === 'count' ||
          metric.operator === 'sum' ||
          metric.operator === 'avg'
            ? 'number'
            : sourceSchema?.type ?? 'string',
      };
    });

    return derivedSchema;
  }

  private parseDirectiveCondition(rawValue: string): ParsedCondition {
    const match = rawValue.match(/^([^:]+):([^:]+):(.*)$/);

    if (!match) {
      return {
        raw: rawValue,
        error: 'Invalid format',
      };
    }

    return {
      field: match[1].replace(/\\:/g, ':'),
      operator: this.normalizeOperator(match[2]),
      rawValue: match[3],
      value: null,
    };
  }

  private parseDirectiveList(value: string): string[] {
    const items = value
      .split(/(?<!\\),/)
      .map((item) => item.replace(/\\,/g, ',').trim())
      .filter(Boolean);

    if (items.length === 0) {
      throw new Error('Directive requires at least one value');
    }

    return items;
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
