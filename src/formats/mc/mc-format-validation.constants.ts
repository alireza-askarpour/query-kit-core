import type { MongoValidationOptions } from './mc-format-validation.types';

export const MC_OPERATOR_ALIASES: Record<string, string> = {
  eq: 'eq',
  ne: 'neq',
  neq: 'neq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
  nin: 'notIn',
  notin: 'notIn',
  all: 'all',
  regex: 'regex',
  exists: 'exists',
  size: 'size',
  elemmatch: 'elemMatch',
};

export const MC_VALID_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'all',
  'regex',
  'exists',
  'size',
  'elemMatch',
] as const;

export const MC_DISPLAY_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'all',
  'regex',
  'exists',
  'size',
  'elemMatch',
];

export const DEFAULT_MC_VALIDATION_OPTIONS: MongoValidationOptions = {
  maxConditions: 50,
  maxValueLength: 2000,
  allowNestedFields: true,
  strictMode: false,
  allowObjectOperators: false,
};

export const MC_DANGEROUS_PATTERNS = [
  { pattern: /\$where/i, message: 'Mongo $where is not allowed' },
  { pattern: /function\s*\(/i, message: 'Executable function payload detected' },
  { pattern: /javascript:/i, message: 'JavaScript protocol detected' },
  { pattern: /<script/i, message: 'Script tag detected' },
] as const;
