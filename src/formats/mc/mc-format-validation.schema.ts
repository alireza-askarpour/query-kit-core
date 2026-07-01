import {
  MC_DISPLAY_OPERATORS,
  MC_VALID_OPERATORS,
} from './mc-format-validation.constants';
import {
  MongoFieldSchema,
  MongoValidationError,
  MongoValidationOptions,
} from './mc-format-validation.types';

export function validateMongoFieldName(field: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field);
}

export function validateMongoNestedField(
  field: string,
  options: MongoValidationOptions,
): { isValid: boolean; errors: MongoValidationError[] } {
  const errors: MongoValidationError[] = [];

  if (!options.allowNestedFields && field.includes('.')) {
    errors.push({
      field,
      message: 'Nested fields are not allowed',
      code: 'NESTED_FIELDS_NOT_ALLOWED',
    });
  }

  field.split('.').forEach((segment) => {
    if (!validateMongoFieldName(segment)) {
      errors.push({
        field,
        message: `Invalid nested field segment '${segment}'`,
        code: 'INVALID_NESTED_SEGMENT',
      });
    }
  });

  return { isValid: errors.length === 0, errors };
}

export function validateMongoDateFormat(dateString: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
}

export function isValidMongoOperator(operator: string): boolean {
  return MC_VALID_OPERATORS.includes(
    operator as (typeof MC_VALID_OPERATORS)[number],
  );
}

export function getMongoValidOperatorsList(): string {
  return MC_DISPLAY_OPERATORS.join(', ');
}

export function getAllowedMongoOperatorsForType(type?: string): string[] {
  const commonOps = ['eq', 'neq', 'exists'];
  const compareOps = ['gt', 'gte', 'lt', 'lte'];

  switch (type) {
    case 'string':
      return [...commonOps, 'in', 'notIn', 'regex'];
    case 'number':
      return [...commonOps, ...compareOps, 'in', 'notIn'];
    case 'boolean':
      return [...commonOps];
    case 'date':
      return [...commonOps, ...compareOps, 'in', 'notIn'];
    case 'array':
      return [...commonOps, 'in', 'notIn', 'all', 'size', 'elemMatch'];
    case 'object':
      return [...commonOps, 'elemMatch'];
    default:
      return [
        ...commonOps,
        ...compareOps,
        'in',
        'notIn',
        'all',
        'regex',
        'size',
        'elemMatch',
      ];
  }
}

export function mergeMongoValidationOptions(
  defaults: MongoValidationOptions,
  overrides: MongoValidationOptions,
): MongoValidationOptions {
  return { ...defaults, ...overrides };
}

export function validateMongoValueBySchema(
  field: string,
  value: unknown,
  schema: MongoFieldSchema,
  operator: string,
): { errors: MongoValidationError[]; warnings: MongoValidationError[] } {
  const errors: MongoValidationError[] = [];
  const warnings: MongoValidationError[] = [];

  if (schema.enum && operator !== 'in' && operator !== 'notIn') {
    validateMongoEnum(field, value, schema.enum, errors);
  }

  if (schema.type === 'number' && typeof value === 'number') {
    validateMongoNumberBounds(field, value, schema, errors);
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    validateMongoArrayBounds(field, value, schema, errors);
  }

  if (schema.type === 'string' && typeof value === 'string') {
    validateMongoStringRules(field, value, schema, errors);
  }

  if (
    schema.required &&
    operator === 'eq' &&
    (value === null || value === undefined || value === '')
  ) {
    errors.push({
      field,
      message: `Field '${field}' is required`,
      code: 'REQUIRED_FIELD',
    });
  }

  return { errors, warnings };
}

function validateMongoEnum(
  field: string,
  value: unknown,
  allowedValues: unknown[],
  errors: MongoValidationError[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!allowedValues.includes(item)) {
        errors.push({
          field,
          value: item,
          message: `Value '${item}' is not allowed. Allowed values: ${allowedValues.join(', ')}`,
          code: 'ENUM_VIOLATION',
        });
      }
    });
    return;
  }

  if (!allowedValues.includes(value)) {
    errors.push({
      field,
      value,
      message: `Value '${value}' is not allowed. Allowed values: ${allowedValues.join(', ')}`,
      code: 'ENUM_VIOLATION',
    });
  }
}

function validateMongoNumberBounds(
  field: string,
  value: number,
  schema: MongoFieldSchema,
  errors: MongoValidationError[],
): void {
  if (schema.min !== undefined && value < schema.min) {
    errors.push({
      field,
      value,
      message: `Value ${value} is less than minimum ${schema.min}`,
      code: 'MIN_VALUE_VIOLATION',
    });
  }

  if (schema.max !== undefined && value > schema.max) {
    errors.push({
      field,
      value,
      message: `Value ${value} is greater than maximum ${schema.max}`,
      code: 'MAX_VALUE_VIOLATION',
    });
  }
}

function validateMongoArrayBounds(
  field: string,
  value: unknown[],
  schema: MongoFieldSchema,
  errors: MongoValidationError[],
): void {
  if (schema.min !== undefined && value.length < schema.min) {
    errors.push({
      field,
      value: value.length,
      message: `Array must have at least ${schema.min} item(s)`,
      code: 'MIN_ITEMS_VIOLATION',
    });
  }

  if (schema.max !== undefined && value.length > schema.max) {
    errors.push({
      field,
      value: value.length,
      message: `Array must have at most ${schema.max} item(s)`,
      code: 'MAX_ITEMS_VIOLATION',
    });
  }
}

function validateMongoStringRules(
  field: string,
  value: string,
  schema: MongoFieldSchema,
  errors: MongoValidationError[],
): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      field,
      value,
      message: `String must be at least ${schema.minLength} characters`,
      code: 'MIN_LENGTH_VIOLATION',
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      field,
      value,
      message: `String must be at most ${schema.maxLength} characters`,
      code: 'MAX_LENGTH_VIOLATION',
    });
  }

  if (schema.pattern && !schema.pattern.test(value)) {
    errors.push({
      field,
      value,
      message: `String does not match required pattern for '${field}'`,
      code: 'PATTERN_VIOLATION',
    });
  }
}
