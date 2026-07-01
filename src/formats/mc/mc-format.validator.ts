import { Inject, Injectable, Optional } from '@nestjs/common';
import { FilterFormatValidator } from '../../core';
import {
  DEFAULT_MC_VALIDATION_OPTIONS,
  MC_OPERATOR_ALIASES,
} from './mc-format-validation.constants';
import { parseMongoQueryString } from './mc-format-validation.parser';
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
  ): MongoValidationResult {
    const errors: MongoValidationError[] = [];
    const warnings: MongoValidationError[] = [];

    if (!queryString || queryString.trim() === '') {
      return this.createEmptyResult();
    }

    const conditions = parseMongoQueryString(queryString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat: validateMongoDateFormat,
      parseObjectLiteral: this.parseObjectLiteral.bind(this),
    });

    if (conditions.length > (this.options.maxConditions ?? 50)) {
      errors.push({
        field: 'query',
        message: `Too many conditions. Maximum allowed: ${this.options.maxConditions}`,
        code: 'MAX_CONDITIONS_EXCEEDED',
      });
    }

    const sanitizedConditions: MongoSanitizedCondition[] = [];

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

  private validateCondition(
    condition: MongoParsedCondition,
    schema: Record<string, MongoFieldSchema> | undefined,
    index: number,
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

    if (schema && !schema[field] && this.options.strictMode) {
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

    const fieldSchema = schema?.[field];
    const allowedOperators =
      fieldSchema?.allowedOperators ||
      getAllowedMongoOperatorsForType(fieldSchema?.type);

    if (!isValidMongoOperator(operator)) {
      errors.push({
        field,
        operator,
        message: `Invalid operator '${operator}'. Valid operators: ${getMongoValidOperatorsList()}`,
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
      parsedValue = parseMongoValueByOperator(rawValue, operator, fieldSchema, {
        normalizeOperator: this.normalizeOperator.bind(this),
        validateDateFormat: validateMongoDateFormat,
        parseObjectLiteral: this.parseObjectLiteral.bind(this),
      });
      (sanitized as MongoParsedConditionInput).value = parsedValue;
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

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  private normalizeOperator(operator: string): string {
    const normalized = operator.replace(/^\$/, '').toLowerCase();
    return MC_OPERATOR_ALIASES[normalized] ?? operator;
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
}
