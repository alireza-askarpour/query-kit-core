import {
  MongoFieldSchema,
  MongoValidationDependencies,
} from './mc-format-validation.types';

export function parseMongoValueByOperator(
  rawValue: string,
  operator: string,
  fieldSchema: MongoFieldSchema | undefined,
  dependencies: MongoValidationDependencies,
): unknown {
  switch (operator) {
    case 'in':
    case 'notIn':
    case 'all':
      return parseMongoArrayValue(rawValue, fieldSchema);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'size':
      return parseMongoNumericValue(rawValue, operator);
    case 'exists':
      return parseMongoBooleanValue(rawValue, operator);
    case 'regex':
      return parseMongoRegexValue(rawValue);
    case 'elemMatch':
      return dependencies.parseObjectLiteral(rawValue);
    case 'eq':
    case 'neq':
      return parseMongoEqualityValue(rawValue, fieldSchema, dependencies);
    default:
      return rawValue;
  }
}

function parseMongoArrayValue(
  rawValue: string,
  fieldSchema?: MongoFieldSchema,
): unknown[] {
  const values = rawValue.split(',').map((value) => value.trim()).filter(Boolean);

  if (values.length === 0) {
    throw new Error('Array operator requires at least one value');
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
    return values.map((value) => parseMongoBooleanLiteral(value));
  }

  return values.map((value) => parseMongoPrimitive(value));
}

function parseMongoNumericValue(rawValue: string, operator: string): number {
  const numericValue = Number(rawValue);

  if (Number.isNaN(numericValue)) {
    throw new Error(`Operator ${operator} requires numeric value`);
  }

  if (operator === 'size' && numericValue < 0) {
    throw new Error('Size cannot be negative');
  }

  return numericValue;
}

function parseMongoBooleanValue(rawValue: string, operator: string): boolean {
  const normalized = rawValue.toLowerCase();

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new Error(`Operator ${operator} requires boolean value`);
}

function parseMongoRegexValue(rawValue: string): string {
  if (!rawValue) {
    throw new Error('Regex pattern cannot be empty');
  }

  try {
    new RegExp(rawValue);
    return rawValue;
  } catch {
    throw new Error(`Invalid regular expression: ${rawValue}`);
  }
}

function parseMongoEqualityValue(
  rawValue: string,
  fieldSchema: MongoFieldSchema | undefined,
  dependencies: MongoValidationDependencies,
): unknown {
  if (fieldSchema?.type === 'number') {
    const numericValue = Number(rawValue);
    if (Number.isNaN(numericValue)) {
      throw new Error(`Expected number, got: ${rawValue}`);
    }
    return numericValue;
  }

  if (fieldSchema?.type === 'boolean') {
    return parseMongoBooleanValue(rawValue, 'eq');
  }

  if (fieldSchema?.type === 'date') {
    dependencies.validateDateFormat(rawValue);
    return rawValue;
  }

  if (fieldSchema?.type === 'object') {
    return dependencies.parseObjectLiteral(rawValue);
  }

  return parseMongoPrimitive(rawValue);
}

function parseMongoPrimitive(value: string): unknown {
  const normalized = value.toLowerCase();

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;

  const numericValue = Number(value);
  if (value !== '' && !Number.isNaN(numericValue) && /^-?\d+(\.\d+)?$/.test(value)) {
    return numericValue;
  }

  return value;
}

function parseMongoBooleanLiteral(value: string): boolean {
  return parseMongoBooleanValue(value, 'eq');
}
