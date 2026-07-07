import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  FilterFormatValidator,
  getDefaultFilterOperatorRegistry,
  normalizeOperatorValidationOutcome,
} from '../../core';
import {
  DEFAULT_VALIDATION_OPTIONS,
  OPERATOR_ALIASES,
} from './sc-format-validation.constants';
import {
  parseQueryDocument,
  ParsedQueryDocument,
} from './sc-format-validation.parser';
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
import {
  resolveValidationContext,
  runValidationHook,
  validateFieldAgainstLists,
  validateFieldRoleAccess,
  ValidationContext,
} from '../validation-policy.utils';
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
    context?: ValidationContext,
  ): ValidationResult {
    return this.validateQuery({ filterString: queryString }, schema, context);
  }

  validateQuery(
    query: { filterString: string },
    schema?: Record<string, FieldSchema>,
    context?: ValidationContext,
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const validationContext = resolveValidationContext(
      this.options.validationContext,
      context,
    );
    const effectiveSchema = this.resolveSchema(schema);

    if (!query.filterString || query.filterString.trim() === '') {
      return this.createEmptyResult();
    }

    const parsedQuery = parseQueryDocument(query.filterString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat,
    });
    const aggregationValidation = this.validateAggregationDirectives(
      parsedQuery,
      effectiveSchema,
      validationContext,
    );
    errors.push(...aggregationValidation.errors);
    warnings.push(...aggregationValidation.warnings);

    if (
      parsedQuery.conditions.length + aggregationValidation.havingConditionCount >
      (this.options.maxConditions ?? 50)
    ) {
      errors.push({
        field: 'query',
        message: `Too many conditions. Maximum allowed: ${this.options.maxConditions}`,
        code: 'MAX_CONDITIONS_EXCEEDED',
      });
    }

    const sanitizedConditions: SanitizedCondition[] = [];

    parsedQuery.conditions.forEach((condition, index) => {
      const result = this.validateCondition(
        condition,
        effectiveSchema,
        index,
        validationContext,
      );
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
      parsedQuery,
    } as ValidationResult & { parsedQuery: ParsedQueryDocument };
  }

  validateAndSanitize(
    queryString: string,
    schema?: Record<string, FieldSchema>,
    context?: ValidationContext,
  ): {
    valid: boolean;
    conditions: SanitizedCondition[];
    errors: ValidationError[];
    warnings: ValidationError[];
  } {
    const result = this.validate(queryString, schema, context);
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
    context?: ValidationContext,
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
    const fieldSchema = schema?.[field];

    errors.push(
      ...validateFieldAgainstLists(
        field,
        this.options.fieldWhitelist,
        this.options.fieldBlacklist,
      ) as ValidationError[],
    );
    errors.push(
      ...validateFieldRoleAccess(
        field,
        context,
        fieldSchema?.access,
        this.options.roleFieldAccess,
      ) as ValidationError[],
    );

    if (schema && !fieldSchema && this.options.strictMode) {
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

    const allowedOperators =
      fieldSchema?.allowedOperators || this.getAllowedOperators(fieldSchema?.type);

    if (!this.isSupportedOperator(operator)) {
      errors.push({
        field,
        operator,
        message: `Invalid operator '${operator}'. Valid operators: ${this.getValidOperatorsList()}`,
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
    let transformedValue = false;
    try {
      parsedValue = this.parseOperatorValue(
        rawValue,
        operator,
        field,
        fieldSchema,
        context,
      );
      if (fieldSchema?.transform) {
        transformedValue = true;
        parsedValue = fieldSchema.transform({
          field,
          operator,
          rawValue,
          value: parsedValue,
          schema: fieldSchema,
          context,
        });
      }
      (sanitized as ParsedConditionInput).value = parsedValue;
    } catch (error) {
      errors.push({
        field,
        operator,
        value: rawValue,
        message: error instanceof Error ? error.message : String(error),
        code: transformedValue ? 'VALUE_TRANSFORM_ERROR' : 'VALUE_PARSE_ERROR',
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

    if (parsedValue !== undefined) {
      const pluginValidation = this.validateCustomOperator(
        field,
        operator,
        rawValue,
        parsedValue,
        fieldSchema,
        context,
      );
      errors.push(...pluginValidation.errors);
      warnings.push(...pluginValidation.warnings);

      const fieldHookResult = runValidationHook(fieldSchema?.validate, {
        field,
        operator,
        rawValue,
        value: parsedValue,
        schema: fieldSchema,
        context,
      });
      errors.push(...(fieldHookResult.errors as ValidationError[]));
      warnings.push(...(fieldHookResult.warnings as ValidationError[]));

      const customHookResult = runValidationHook(this.options.customValidator, {
        field,
        operator,
        rawValue,
        value: parsedValue,
        schema: fieldSchema,
        context,
      });
      errors.push(...(customHookResult.errors as ValidationError[]));
      warnings.push(...(customHookResult.warnings as ValidationError[]));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  private normalizeOperator(operator: string): string {
    return (
      OPERATOR_ALIASES[operator.toLowerCase()] ??
      getDefaultFilterOperatorRegistry().resolveFormatOperatorName(
        this.formatName,
        operator,
      ) ??
      operator
    );
  }

  private validateAggregationDirectives(
    parsedQuery: ParsedQueryDocument,
    schema?: Record<string, FieldSchema>,
    context?: ValidationContext,
  ): {
    errors: ValidationError[];
    warnings: ValidationError[];
    havingConditionCount: number;
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const metrics: Array<{ field?: string; operator: string; alias?: string }> = [];
    const groupByFields: string[] = [];
 
    parsedQuery.directiveSegments.forEach((part: string) => {
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
      this.validateAggregationFieldReference(field, schema, errors, context);
    });

    metrics.forEach((metric) => {
      if (metric.field) {
        this.validateAggregationFieldReference(metric.field, schema, errors, context);
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

    parsedQuery.parsedHavingConditions.forEach(
      (parsed: ParsedCondition, index: number) => {
      const result = this.validateCondition(parsed, havingSchema, index, context);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      },
    );

    return {
      errors,
      warnings,
      havingConditionCount: parsedQuery.parsedHavingConditions.length,
    };
  }

  private validateAggregationFieldReference(
    field: string,
    schema: Record<string, FieldSchema> | undefined,
    errors: ValidationError[],
    context?: ValidationContext,
  ): void {
    const fieldSchema = schema?.[field];

    errors.push(
      ...validateFieldAgainstLists(
        field,
        this.options.fieldWhitelist,
        this.options.fieldBlacklist,
      ) as ValidationError[],
    );
    errors.push(
      ...validateFieldRoleAccess(
        field,
        context,
        fieldSchema?.access,
        this.options.roleFieldAccess,
      ) as ValidationError[],
    );

    if (schema && !fieldSchema && this.options.strictMode) {
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

  private resolveSchema(
    schema?: Record<string, FieldSchema>,
  ): Record<string, FieldSchema> | undefined {
    if (!this.options.allowedFields) {
      return schema;
    }

    return {
      ...this.options.allowedFields,
      ...(schema ?? {}),
    };
  }

  private isSupportedOperator(operator: string): boolean {
    return (
      isValidOperator(operator) ||
      Boolean(
        getDefaultFilterOperatorRegistry().getFormatOperator(
          this.formatName,
          operator,
        ),
      )
    );
  }

  private getValidOperatorsList(): string {
    const customOperators = getDefaultFilterOperatorRegistry()
      .listFormatOperators(this.formatName)
      .map((plugin) => plugin.operator);

    return [...new Set([...getValidOperatorsList().split(', '), ...customOperators])].join(
      ', ',
    );
  }

  private getAllowedOperators(type?: string): string[] {
    const defaultOperators = getAllowedOperatorsForType(type);
    const customOperators = getDefaultFilterOperatorRegistry()
      .listFormatOperators(this.formatName)
      .filter(
        (plugin) =>
          !plugin.supportedFieldTypes?.length ||
          !type ||
          plugin.supportedFieldTypes.includes(type),
      )
      .map((plugin) => plugin.operator);

    return [...new Set([...defaultOperators, ...customOperators])];
  }

  private parseOperatorValue(
    rawValue: string,
    operator: string,
    field: string,
    fieldSchema: FieldSchema | undefined,
    context?: ValidationContext,
  ): unknown {
    const plugin = getDefaultFilterOperatorRegistry().getFormatOperator(
      this.formatName,
      operator,
    );

    if (plugin?.parseValue) {
      return plugin.parseValue(rawValue, {
        formatName: this.formatName,
        field,
        operator,
        rawValue,
        fieldSchema,
        validationContext: context,
        parseList: this.parseDirectiveList,
        parseInteger: (value: string, label: string, allowZero = false) => {
          const parsed = Number(value);

          if (!Number.isInteger(parsed) || (!allowZero && parsed <= 0) || parsed < 0) {
            throw new Error(`${label} requires a valid integer`);
          }

          return parsed;
        },
        parseBoolean: (value: string, label: string) => {
          const normalized = value.trim().toLowerCase();

          if (normalized === 'true') return true;
          if (normalized === 'false') return false;

          throw new Error(`${label} requires "true" or "false"`);
        },
        parsePrimitive: (value: string) => {
          const normalized = value.toLowerCase();
          if (normalized === 'true') return true;
          if (normalized === 'false') return false;
          if (normalized === 'null') return null;

          const numericValue = Number(value);
          if (value !== '' && !Number.isNaN(numericValue) && /^-?\d+(\.\d+)?$/.test(value)) {
            return numericValue;
          }

          return value;
        },
        validateDateFormat,
      });
    }

    return parseValueByOperator(rawValue, operator, fieldSchema, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat,
    });
  }

  private validateCustomOperator(
    field: string,
    operator: string,
    rawValue: string,
    value: unknown,
    fieldSchema: FieldSchema | undefined,
    context?: ValidationContext,
  ): { errors: ValidationError[]; warnings: ValidationError[] } {
    const plugin = getDefaultFilterOperatorRegistry().getFormatOperator(
      this.formatName,
      operator,
    );

    if (!plugin?.validate) {
      return { errors: [], warnings: [] };
    }

    const result = normalizeOperatorValidationOutcome(
      plugin.validate({
        formatName: this.formatName,
        field,
        operator,
        rawValue,
        value,
        fieldSchema,
        validationContext: context,
      }),
      { field, operator, value },
    );

    return {
      errors: (result.errors ?? []) as ValidationError[],
      warnings: (result.warnings ?? []) as ValidationError[],
    };
  }
}
