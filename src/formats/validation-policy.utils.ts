import type { FilterValidationIssue } from '../core';

export interface ValidationContext {
  role?: string;
  roles?: string[];
  [key: string]: unknown;
}

export interface RoleAccessPolicy {
  allowRoles?: string[];
  denyRoles?: string[];
}

export interface RoleFieldAccessPolicy {
  allowFields?: string[];
  denyFields?: string[];
}

export interface CustomValidationIssue {
  code: string;
  message: string;
  value?: unknown;
  level?: 'error' | 'warning';
}

export interface ValueTransformerInput<TSchema> {
  field: string;
  operator: string;
  rawValue: string;
  value: unknown;
  schema?: TSchema;
  context?: ValidationContext;
}

export interface ValidationHookInput<TSchema> extends ValueTransformerInput<TSchema> {}

export type ValueTransformer<TSchema> = (
  input: ValueTransformerInput<TSchema>,
) => unknown;

export type ValidationHook<TSchema> = (
  input: ValidationHookInput<TSchema>,
) => void | CustomValidationIssue | CustomValidationIssue[];

export function resolveValidationContext(
  defaultContext: ValidationContext | undefined,
  overrideContext: ValidationContext | undefined,
): ValidationContext | undefined {
  if (!defaultContext && !overrideContext) {
    return undefined;
  }

  return {
    ...(defaultContext ?? {}),
    ...(overrideContext ?? {}),
    roles: mergeRoles(defaultContext, overrideContext),
  };
}

export function validateFieldAgainstLists(
  field: string,
  whitelist: string[] | undefined,
  blacklist: string[] | undefined,
): FilterValidationIssue[] {
  const issues: FilterValidationIssue[] = [];

  if (blacklist?.some((pattern) => matchesFieldPattern(field, pattern))) {
    issues.push({
      field,
      message: `Field '${field}' is blacklisted`,
      code: 'FIELD_BLACKLISTED',
    });
  }

  if (
    whitelist?.length &&
    !whitelist.some((pattern) => matchesFieldPattern(field, pattern))
  ) {
    issues.push({
      field,
      message: `Field '${field}' is not in the whitelist`,
      code: 'FIELD_NOT_WHITELISTED',
    });
  }

  return issues;
}

export function validateFieldRoleAccess(
  field: string,
  context: ValidationContext | undefined,
  fieldPolicy: RoleAccessPolicy | undefined,
  rolePolicies: Record<string, RoleFieldAccessPolicy> | undefined,
): FilterValidationIssue[] {
  const issues: FilterValidationIssue[] = [];
  const roles = getContextRoles(context);

  if (roles.length === 0) {
    return issues;
  }

  if (fieldPolicy?.denyRoles?.some((role) => roles.includes(role))) {
    issues.push({
      field,
      message: `Field '${field}' is not accessible for the active role`,
      code: 'FIELD_ROLE_DENIED',
    });
    return issues;
  }

  if (
    fieldPolicy?.allowRoles?.length &&
    !fieldPolicy.allowRoles.some((role) => roles.includes(role))
  ) {
    issues.push({
      field,
      message: `Field '${field}' is not accessible for the active role`,
      code: 'FIELD_ROLE_DENIED',
    });
    return issues;
  }

  const activePolicies = roles
    .map((role) => rolePolicies?.[role])
    .filter((policy): policy is RoleFieldAccessPolicy => Boolean(policy));

  if (activePolicies.some((policy) => policy.denyFields?.some((pattern) => matchesFieldPattern(field, pattern)))) {
    issues.push({
      field,
      message: `Field '${field}' is denied for the active role`,
      code: 'FIELD_ROLE_DENIED',
    });
    return issues;
  }

  const allowPatterns = activePolicies.flatMap((policy) => policy.allowFields ?? []);
  if (
    allowPatterns.length > 0 &&
    !allowPatterns.some((pattern) => matchesFieldPattern(field, pattern))
  ) {
    issues.push({
      field,
      message: `Field '${field}' is not allowed for the active role`,
      code: 'FIELD_ROLE_DENIED',
    });
  }

  return issues;
}

export function runValidationHook<TSchema>(
  hook: ValidationHook<TSchema> | undefined,
  input: ValidationHookInput<TSchema>,
): { errors: FilterValidationIssue[]; warnings: FilterValidationIssue[] } {
  if (!hook) {
    return { errors: [], warnings: [] };
  }

  const result = hook(input);
  const issues = Array.isArray(result) ? result : result ? [result] : [];

  return issues.reduce(
    (accumulator, issue) => {
      const normalizedIssue: FilterValidationIssue = {
        field: input.field,
        operator: input.operator,
        value: issue.value ?? input.value,
        message: issue.message,
        code: issue.code,
      };

      if (issue.level === 'warning') {
        accumulator.warnings.push(normalizedIssue);
      } else {
        accumulator.errors.push(normalizedIssue);
      }

      return accumulator;
    },
    { errors: [] as FilterValidationIssue[], warnings: [] as FilterValidationIssue[] },
  );
}

function mergeRoles(
  defaultContext: ValidationContext | undefined,
  overrideContext: ValidationContext | undefined,
): string[] | undefined {
  const roles = new Set<string>([
    ...getContextRoles(defaultContext),
    ...getContextRoles(overrideContext),
  ]);

  return roles.size > 0 ? [...roles] : undefined;
}

function getContextRoles(context: ValidationContext | undefined): string[] {
  if (!context) {
    return [];
  }

  const roles = new Set<string>();

  if (typeof context.role === 'string' && context.role) {
    roles.add(context.role);
  }

  (context.roles ?? []).forEach((role) => {
    if (typeof role === 'string' && role) {
      roles.add(role);
    }
  });

  return [...roles];
}

function matchesFieldPattern(field: string, pattern: string): boolean {
  return field === pattern || field.startsWith(`${pattern}.`);
}
