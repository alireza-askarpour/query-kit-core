import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  FilterFormatValidator,
  getDefaultFilterOperatorRegistry,
  normalizeOperatorValidationOutcome,
} from '../../core';
import {
  DEFAULT_MC_VALIDATION_OPTIONS,
  MC_OPERATOR_ALIASES,
} from './mc-format-validation.constants';
import {
  MongoParsedQueryDocument,
  parseEscapedList,
  parseMongoQueryDocument,
} from './mc-format-validation.parser';
import {
  getAllowedMongoOperatorsForType,
  getMongoValidOperatorsList,
  isValidMongoOperator,
  mergeMongoValidationOptions,
  validateMongoDateFormat,
  validateMongoFieldName,
  validateMongoNestedField,
  validateMongoValueBySchema,
} from './mc-format-validation.schema';
import { parseMongoValueByOperator } from './mc-format-validation.value';
import { mongoSecurityCheck } from './mc-format-validation.security';
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
  MongoConditionValidationResult,
  MongoFieldSchema,
  MongoParsedCondition,
  MongoParsedConditionInput,
  MongoSanitizedCondition,
  MongoValidationError,
  MongoValidationOptions,
  MongoValidationResult,
} from './mc-format-validation.types';

export type {
  MongoFieldSchema,
  MongoValidationError,
  MongoValidationOptions,
  MongoValidationResult,
} from './mc-format-validation.types';

@Injectable()
export class MCFormatValidator
  implements
    FilterFormatValidator<Record<string, MongoFieldSchema>, MongoSanitizedCondition[]>
{
  formatName = 'mcfilter';
  private readonly options: MongoValidationOptions;

  constructor(
    @Optional()
    @Inject('MC_FORMAT_VALIDATION_OPTIONS')
    options: MongoValidationOptions = {},
  ) {
    this.options = mergeMongoValidationOptions(
      DEFAULT_MC_VALIDATION_OPTIONS,
      options,
    );
  }

  validate(
    queryString: string,
    schema?: Record<string, MongoFieldSchema>,
    context?: ValidationContext,
  ): MongoValidationResult {
    return this.validateQuery({ filterString: queryString }, schema, context);
  }

  validateQuery(
    query: { filterString: string },
    schema?: Record<string, MongoFieldSchema>,
    context?: ValidationContext,
  ): MongoValidationResult {
    const errors: MongoValidationError[] = [];
    const warnings: MongoValidationError[] = [];
    const validationContext = resolveValidationContext(
      this.options.validationContext,
      context,
    );
    const effectiveSchema = this.resolveSchema(schema);

    if (!query.filterString || query.filterString.trim() === '') {
      return this.createEmptyResult();
    }

    const parsedQuery = parseMongoQueryDocument(query.filterString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat: validateMongoDateFormat,
      parseObjectLiteral: this.parseObjectLiteral.bind(this),
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

    const sanitizedConditions: MongoSanitizedCondition[] = [];

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
    } as MongoValidationResult & { parsedQuery: MongoParsedQueryDocument };
  }

  private validateCondition(
    condition: MongoParsedCondition,
    schema: Record<string, MongoFieldSchema> | undefined,
    index: number,
    context?: ValidationContext,
  ): MongoConditionValidationResult {
    const errors: MongoValidationError[] = [];
    const warnings: MongoValidationError[] = [];
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
      ) as MongoValidationError[],
    );
    errors.push(
      ...validateFieldRoleAccess(
        field,
        context,
        fieldSchema?.access,
        this.options.roleFieldAccess,
      ) as MongoValidationError[],
    );

    if (schema && !fieldSchema && this.options.strictMode) {
      errors.push({
        field,
        message: `Field '${field}' is not allowed in schema`,
        code: 'FIELD_NOT_ALLOWED',
      });
    }

    if (!validateMongoFieldName(field)) {
      errors.push({
        field,
        message:
          `Invalid field name '${field}'. Only alphanumeric, dots, and underscores allowed`,
        code: 'INVALID_FIELD_NAME',
      });
    }

    if (field.includes('.')) {
      const nestedResult = validateMongoNestedField(field, this.options);
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
      (sanitized as MongoParsedConditionInput).value = parsedValue;
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
      const schemaValidation = validateMongoValueBySchema(
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
      rawValue.length > (this.options.maxValueLength ?? 2000)
    ) {
      errors.push({
        field,
        operator,
        value: rawValue,
        message: `Value too long. Maximum length: ${this.options.maxValueLength}`,
        code: 'VALUE_TOO_LONG',
      });
    }

    const securityResult = mongoSecurityCheck(rawValue);
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
      errors.push(...(fieldHookResult.errors as MongoValidationError[]));
      warnings.push(...(fieldHookResult.warnings as MongoValidationError[]));

      const customHookResult = runValidationHook(this.options.customValidator, {
        field,
        operator,
        rawValue,
        value: parsedValue,
        schema: fieldSchema,
        context,
      });
      errors.push(...(customHookResult.errors as MongoValidationError[]));
      warnings.push(...(customHookResult.warnings as MongoValidationError[]));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  private normalizeOperator(operator: string): string {
    const normalized = operator.replace(/^\$/, '').toLowerCase();
    return (
      MC_OPERATOR_ALIASES[normalized] ??
      getDefaultFilterOperatorRegistry().resolveFormatOperatorName(
        this.formatName,
        normalized,
      ) ??
      operator
    );
  }

  private validateAggregationDirectives(
    parsedQuery: MongoParsedQueryDocument,
    schema?: Record<string, MongoFieldSchema>,
    context?: ValidationContext,
  ): {
    errors: MongoValidationError[];
    warnings: MongoValidationError[];
    havingConditionCount: number;
  } {
    const errors: MongoValidationError[] = [];
    const warnings: MongoValidationError[] = [];
    const metrics: Array<{ field?: string; operator: string; alias?: string }> = [];
    const groupByFields: string[] = [];
 
    parsedQuery.directives.forEach((directiveSegment) => {
      const { rawName, name: directive, value } = directiveSegment;
      try {
        switch (directive) {
          case 'aggregate':
            metrics.push(
              ...parseAggregationDirective(value, this.parseDirectiveList, '@aggregate'),
            );
            break;
          case 'groupby':
            groupByFields.push(
              ...parseGroupByDirective(value, this.parseDirectiveList, '@groupBy'),
            );
            break;
          case 'having':
            break;
          default:
            break;
        }
      } catch (error) {
        errors.push({
          field: rawName,
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
      (parsed: MongoParsedCondition, index: number) => {
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
    schema: Record<string, MongoFieldSchema> | undefined,
    errors: MongoValidationError[],
    context?: ValidationContext,
  ): void {
    const fieldSchema = schema?.[field];

    errors.push(
      ...validateFieldAgainstLists(
        field,
        this.options.fieldWhitelist,
        this.options.fieldBlacklist,
      ) as MongoValidationError[],
    );
    errors.push(
      ...validateFieldRoleAccess(
        field,
        context,
        fieldSchema?.access,
        this.options.roleFieldAccess,
      ) as MongoValidationError[],
    );

    if (schema && !fieldSchema && this.options.strictMode) {
      errors.push({
        field,
        message: `Field '${field}' is not allowed in schema`,
        code: 'FIELD_NOT_ALLOWED',
      });
    }

    if (!validateMongoFieldName(field)) {
      errors.push({
        field,
        message:
          `Invalid field name '${field}'. Only alphanumeric, dots, and underscores allowed`,
        code: 'INVALID_FIELD_NAME',
      });
      return;
    }

    if (field.includes('.')) {
      const nestedResult = validateMongoNestedField(field, this.options);
      if (!nestedResult.isValid) {
        errors.push(...nestedResult.errors);
      }
    }
  }

  private createHavingSchema(
    schema: Record<string, MongoFieldSchema> | undefined,
    groupByFields: string[],
    metrics: Array<{ field?: string; operator: string; alias?: string }>,
  ): Record<string, MongoFieldSchema> | undefined {
    if (!schema && metrics.length === 0 && groupByFields.length === 0) {
      return undefined;
    }

    const derivedSchema: Record<string, MongoFieldSchema> = { ...(schema ?? {}) };

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

  private parseDirectiveList(value: string): string[] {
    const items = parseEscapedList(value);

    if (items.length === 0) {
      throw new Error('Directive requires at least one value');
    }

    return items;
  }

  private parseObjectLiteral(rawValue: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(rawValue);

      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Object expected');
      }

      if (!this.options.allowObjectOperators) {
        const invalidKey = Object.keys(parsed).find((key) => key.startsWith('$'));

        if (invalidKey) {
          throw new Error(
            `Object operators are not allowed in validator payload: '${invalidKey}'`,
          );
        }
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : 'Mongo object value must be valid JSON object',
      );
    }
  }

  private parsePrimitive(value: string): unknown {
    const trimmed = value.trim();
    const lowered = trimmed.toLowerCase();

    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    if (lowered === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    return trimmed;
  }

  private createEmptyResult(): MongoValidationResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      sanitizedConditions: [],
      sanitized: [],
    };
  }

  private isSanitizedCondition(
    condition: MongoParsedCondition,
  ): condition is MongoSanitizedCondition {
    return 'field' in condition && 'rawValue' in condition && 'operator' in condition;
  }

  private resolveSchema(
    schema?: Record<string, MongoFieldSchema>,
  ): Record<string, MongoFieldSchema> | undefined {
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
      isValidMongoOperator(operator) ||
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

    return [...new Set([...getMongoValidOperatorsList().split(', '), ...customOperators])].join(
      ', ',
    );
  }

  private getAllowedOperators(type?: string): string[] {
    const defaultOperators = getAllowedMongoOperatorsForType(type);
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
    fieldSchema: MongoFieldSchema | undefined,
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
        parsePrimitive: (value: string) => this.parsePrimitive(value),
        parseObjectLiteral: this.parseObjectLiteral.bind(this),
        validateDateFormat: validateMongoDateFormat,
      });
    }

    return parseMongoValueByOperator(rawValue, operator, fieldSchema, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat: validateMongoDateFormat,
      parseObjectLiteral: this.parseObjectLiteral.bind(this),
    });
  }

  private validateCustomOperator(
    field: string,
    operator: string,
    rawValue: string,
    value: unknown,
    fieldSchema: MongoFieldSchema | undefined,
    context?: ValidationContext,
  ): { errors: MongoValidationError[]; warnings: MongoValidationError[] } {
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
      errors: (result.errors ?? []) as MongoValidationError[],
      warnings: (result.warnings ?? []) as MongoValidationError[],
    };
  }
}
