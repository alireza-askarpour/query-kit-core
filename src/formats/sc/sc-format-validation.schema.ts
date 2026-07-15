import {
  DISPLAY_OPERATORS,
  VALID_OPERATORS,
} from './sc-format-validation.constants';
import type {
  ValidationError,
  ValidationOptions,
} from './sc-format-validation.types';

export function validateFieldName(field: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field);
}

export function validateNestedField(
  field: string,
  options: ValidationOptions,
): { isValid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const parts = field.split('.');

  if (!options.allowRelations && parts.length > 2) {
    errors.push({
      field,
      message: 'Deep nested fields (more than 2 levels) are not allowed',
      code: 'DEEP_NESTING_NOT_ALLOWED',
    });
  }

  for (const part of parts) {
    if (!validateFieldName(part)) {
      errors.push({
        field,
        message: `Invalid nested field segment '${part}'`,
        code: 'INVALID_NESTED_SEGMENT',
      });
      break;
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function validateDateFormat(dateString: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value');
  }
}

export function isValidOperator(operator: string): boolean {
  return VALID_OPERATORS.includes(operator as (typeof VALID_OPERATORS)[number]);
}

export function getValidOperatorsList(): string {
  return DISPLAY_OPERATORS.join(', ');
}

export function getAllowedOperatorsForType(type?: string): string[] {
  const commonOps = ['eq', 'neq'];
  const stringOps = [
    'like',
    'iLike',
    'contains',
    'startsWith',
    'endsWith',
    'regex',
    'in',
    'notIn',
  ];
  const numberOps = ['gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn'];
  const dateOps = [
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'date',
    'year',
    'month',
    'day',
  ];
  const arrayOps = ['size', 'any', 'all', 'in', 'notIn'];
  const nullOps = ['isNull', 'isNotNull', 'exists', 'notExists'];

  switch (type) {
    case 'string':
      return [...commonOps, ...stringOps, ...nullOps];
    case 'number':
      return [...commonOps, ...numberOps, ...nullOps];
    case 'boolean':
      return [...commonOps, ...nullOps];
    case 'date':
      return [...commonOps, ...dateOps, ...nullOps];
    case 'array':
      return [...arrayOps, ...nullOps];
    case 'object':
      return [...nullOps, 'exists', 'notExists'];
    default:
      return [
        ...commonOps,
        ...stringOps,
        ...numberOps,
        ...dateOps,
        ...arrayOps,
        ...nullOps,
      ];
  }
}

export function mergeValidationOptions(
  defaults: ValidationOptions,
  overrides: ValidationOptions,
): ValidationOptions {
  return { ...defaults, ...overrides };
}
