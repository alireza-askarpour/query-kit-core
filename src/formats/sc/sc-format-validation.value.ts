import type {
  FieldSchema,
  ValidationDependencies,
  ValidationError,
} from './sc-format-validation.types';

export function parseValueByOperator(
  rawValue: string,
  operator: string,
  fieldSchema: FieldSchema | undefined,
  dependencies: ValidationDependencies,
): unknown {
  switch (operator) {
    case 'in':
    case 'notIn':
    case 'any':
    case 'all':
      return parseArrayValue(rawValue, operator, fieldSchema);
    case 'between':
      return parseBetweenValue(rawValue, fieldSchema, dependencies);
    case 'size':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return parseNumericValue(rawValue, operator);
    case 'eq':
    case 'neq':
      return parseEqualityValue(rawValue, fieldSchema, dependencies);
    case 'isNull':
    case 'isNotNull':
    case 'exists':
    case 'notExists':
      return rawValue.toLowerCase() === 'true';
    case 'like':
    case 'iLike':
    case 'notLike':
    case 'contains':
    case 'startsWith':
    case 'endsWith':
      ensurePatternValue(rawValue);
      return rawValue;
    case 'regex':
      return parseRegexValue(rawValue);
    case 'date':
      dependencies.validateDateFormat(rawValue);
      return rawValue;
    case 'year':
      return parseYearValue(rawValue);
    case 'month':
      return parseMonthValue(rawValue);
    case 'day':
      return parseDayValue(rawValue);
    default:
      return rawValue;
  }
}

export function validateValueBySchema(
  field: string,
  value: unknown,
  schema: FieldSchema,
  operator: string,
): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (schema.enum && !operator.includes('in') && operator !== 'between') {
    validateEnum(field, value, schema.enum, errors);
  }

  if (schema.type === 'number' && typeof value === 'number') {
    validateNumberBounds(field, value, schema, errors);
  }

  if (Array.isArray(value) && schema.type === 'array') {
    validateArrayBounds(field, value, schema, errors);
  }

  if (schema.type === 'string' && typeof value === 'string') {
    validateStringRules(field, value, schema, errors);
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

function parseArrayValue(
  rawValue: string,
  operator: string,
  fieldSchema?: FieldSchema,
): unknown[] {
  const values = rawValue.split(',').map((value) => value.trim());
  if (values.length === 0) {
    throw new Error(`Operator ${operator} requires at least one value`);
  }

  if (fieldSchema?.type === 'number') {
    return values.map((value) => {
      const numericValue = Number(value);
      if (Number.isNaN(numericValue)) {
        throw new Error(`Invalid number in array: ${value}`);
      }
      return numericValue;
    });
  }

  if (fieldSchema?.type === 'boolean') {
    return values.map((value) => value.toLowerCase() === 'true');
  }

  return values;
}

function parseBetweenValue(
  rawValue: string,
  fieldSchema: FieldSchema | undefined,
  dependencies: ValidationDependencies,
): [unknown, unknown] {
  const [start, end] = rawValue.split(',');

  if (!start || !end) {
    throw new Error('Between operator requires two values separated by comma');
  }

  if (fieldSchema?.type === 'number') {
    const startValue = Number(start.trim());
    const endValue = Number(end.trim());

    if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
      throw new Error('Between values must be numbers');
    }

    if (startValue > endValue) {
      throw new Error('Start value must be less than or equal to end value');
    }

    return [startValue, endValue];
  }

  if (fieldSchema?.type === 'date') {
    dependencies.validateDateFormat(start.trim());
    dependencies.validateDateFormat(end.trim());
  }

  return [start.trim(), end.trim()];
}

function parseNumericValue(rawValue: string, operator: string): number {
  const numericValue = Number(rawValue);

  if (Number.isNaN(numericValue)) {
    throw new Error(`Operator ${operator} requires numeric value`);
  }

  if (operator === 'size' && numericValue < 0) {
    throw new Error('Size cannot be negative');
  }

  return numericValue;
}

function parseEqualityValue(
  rawValue: string,
  fieldSchema: FieldSchema | undefined,
  dependencies: ValidationDependencies,
): unknown {
  const normalizedValue = rawValue.toLowerCase();

  if (normalizedValue === 'true') return true;
  if (normalizedValue === 'false') return false;
  if (normalizedValue === 'null') return null;

  if (fieldSchema?.type === 'number') {
    const numericValue = Number(rawValue);
    if (Number.isNaN(numericValue)) {
      throw new Error(`Expected number, got: ${rawValue}`);
    }
    return numericValue;
  }

  if (fieldSchema?.type === 'boolean') {
    if (!['true', 'false'].includes(normalizedValue)) {
      throw new Error(`Expected boolean (true/false), got: ${rawValue}`);
    }
    return normalizedValue === 'true';
  }

  if (fieldSchema?.type === 'date') {
    dependencies.validateDateFormat(rawValue);
  }

  return rawValue;
}

function ensurePatternValue(rawValue: string): void {
  if (rawValue.length === 0) {
    throw new Error('Pattern cannot be empty');
  }
}

function parseRegexValue(rawValue: string): string {
  try {
    new RegExp(rawValue);
    return rawValue;
  } catch {
    throw new Error(`Invalid regular expression: ${rawValue}`);
  }
}

function parseYearValue(rawValue: string): number {
  if (!/^\d{4}$/.test(rawValue)) {
    throw new Error('Year must be YYYY format');
  }

  return Number.parseInt(rawValue, 10);
}

function parseMonthValue(rawValue: string): string {
  if (!/^\d{4}-\d{2}$/.test(rawValue)) {
    throw new Error('Month must be YYYY-MM format');
  }

  const [, month] = rawValue.split('-');
  const monthValue = Number.parseInt(month, 10);

  if (monthValue < 1 || monthValue > 12) {
    throw new Error('Month must be between 01 and 12');
  }

  return rawValue;
}

function parseDayValue(rawValue: string): number {
  const day = Number.parseInt(rawValue, 10);

  if (Number.isNaN(day) || day < 1 || day > 31) {
    throw new Error('Day must be between 1 and 31');
  }

  return day;
}

function validateEnum(
  field: string,
  value: unknown,
  allowedValues: unknown[],
  errors: ValidationError[],
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

function validateNumberBounds(
  field: string,
  value: number,
  schema: FieldSchema,
  errors: ValidationError[],
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

function validateArrayBounds(
  field: string,
  value: unknown[],
  schema: FieldSchema,
  errors: ValidationError[],
): void {
  if (schema.min !== undefined && value.length < schema.min) {
    errors.push({
      field,
      value: value.length,
      message: `Array must have at least ${schema.min} item(s)`,
      code: 'ARRAY_MIN_SIZE_VIOLATION',
    });
  }

  if (schema.max !== undefined && value.length > schema.max) {
    errors.push({
      field,
      value: value.length,
      message: `Array must have at most ${schema.max} item(s)`,
      code: 'ARRAY_MAX_SIZE_VIOLATION',
    });
  }
}

function validateStringRules(
  field: string,
  value: string,
  schema: FieldSchema,
  errors: ValidationError[],
): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      field,
      value,
      message: `String length ${value.length} is less than minimum ${schema.minLength}`,
      code: 'MIN_LENGTH_VIOLATION',
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      field,
      value,
      message: `String length ${value.length} is greater than maximum ${schema.maxLength}`,
      code: 'MAX_LENGTH_VIOLATION',
    });
  }

  if (schema.pattern && !schema.pattern.test(value)) {
    errors.push({
      field,
      value,
      message: `Value does not match pattern ${schema.pattern}`,
      code: 'PATTERN_VIOLATION',
    });
  }
}
