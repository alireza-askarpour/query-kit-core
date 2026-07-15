import type { FilterPolicyEvaluationResult, FilterPolicyOptions } from '../contracts';
import type { FilterValidationIssue } from '../contracts';
import type {
  FilterExpressionNode,
  FilterIR,
  FilterOperator,
  FilterPredicate} from './filter-ir.interface';
import {
  getAggregationDefinition,
  getFilterExpression,
  getPredicates,
  getRelations,
  getSqlFilterFeatures,
  normalizeRelationDirectives,
} from './filter-ir.interface';
import type { FilterPolicyContext } from '../contracts/filter-policy.interface';

const DEFAULT_EXPENSIVE_OPERATORS = new Set<FilterOperator>([
  'regex',
  'like',
  'iLike',
  'notLike',
  'contains',
  'startsWith',
  'endsWith',
  'any',
  'all',
  'size',
  'elemMatch',
]);

const DEFAULT_REGEX_POLICY = {
  maxLength: 256,
  maxGroupCount: 8,
  maxAlternationCount: 10,
  maxQuantifierCount: 12,
  maxComplexityScore: 80,
  denyNestedQuantifiers: true,
} as const;

export function evaluateFilterPolicy(
  filter: FilterIR,
  policy: FilterPolicyOptions | undefined,
  context?: FilterPolicyContext,
): FilterPolicyEvaluationResult {
  if (!policy) {
    return { errors: [], warnings: [] };
  }

  const errors: FilterValidationIssue[] = [];
  const expression = getFilterExpression(filter);

  if (policy.maxExpressionDepth !== undefined && expression) {
    const depth = getExpressionDepth(expression);
    if (depth > policy.maxExpressionDepth) {
      errors.push({
        field: 'expression',
        value: depth,
        message: `Logical expression depth ${depth} exceeds maximum ${policy.maxExpressionDepth}`,
        code: 'POLICY_MAX_DEPTH_EXCEEDED',
      });
    }
  }

  const relationStats = getRelationStats(filter);
  if (
    policy.maxRelationDepth !== undefined &&
    relationStats.maxDepth > policy.maxRelationDepth
  ) {
    errors.push({
      field: 'relations',
      value: relationStats.maxDepth,
      message: `Relation depth ${relationStats.maxDepth} exceeds maximum ${policy.maxRelationDepth}`,
      code: 'POLICY_MAX_RELATION_DEPTH_EXCEEDED',
    });
  }

  if (
    policy.maxJoins !== undefined &&
    relationStats.total > policy.maxJoins
  ) {
    errors.push({
      field: 'relations',
      value: relationStats.total,
      message: `Join/include count ${relationStats.total} exceeds maximum ${policy.maxJoins}`,
      code: 'POLICY_MAX_JOINS_EXCEEDED',
    });
  }

  if (
    policy.maxPopulates !== undefined &&
    relationStats.total > policy.maxPopulates
  ) {
    errors.push({
      field: 'relations',
      value: relationStats.total,
      message: `Populate/include count ${relationStats.total} exceeds maximum ${policy.maxPopulates}`,
      code: 'POLICY_MAX_POPULATES_EXCEEDED',
    });
  }

  const predicates = collectPolicyPredicates(filter);
  predicates.forEach((predicate) => {
    evaluateArrayPolicy(predicate, policy, errors);
    evaluateRegexPolicy(predicate, policy, errors);
    evaluateExpensiveOperatorPolicy(predicate, policy, context, errors);
  });

  return { errors, warnings: [] };
}

function getExpressionDepth(expression: FilterExpressionNode): number {
  switch (expression.kind) {
    case 'predicate':
      return 1;
    case 'not':
      return 1 + getExpressionDepth(expression.child);
    case 'group':
      return 1 + Math.max(0, ...expression.children.map(getExpressionDepth));
    default:
      return assertNever(expression);
  }
}

function getRelationStats(filter: FilterIR): { total: number; maxDepth: number } {
  const relations = normalizeRelationDirectives(getRelations(filter));
  if (relations.length === 0) {
    return { total: 0, maxDepth: 0 };
  }

  let total = 0;
  let maxDepth = 0;

  const visit = (
    items: ReturnType<typeof normalizeRelationDirectives>,
    depth: number,
  ): void => {
    maxDepth = Math.max(maxDepth, depth);
    total += items.length;

    items.forEach((item) => {
      if (item.nested) {
        visit(normalizeRelationDirectives(item.nested), depth + 1);
      }
    });
  };

  visit(relations, 1);
  return { total, maxDepth };
}

function evaluateArrayPolicy(
  predicate: FilterPredicate,
  policy: FilterPolicyOptions,
  errors: FilterValidationIssue[],
): void {
  if (
    policy.maxArrayLength === undefined ||
    !Array.isArray(predicate.value) ||
    predicate.value.length <= policy.maxArrayLength
  ) {
    return;
  }

  errors.push({
    field: predicate.field,
    operator: predicate.operator,
    value: predicate.value.length,
    message: `Array length ${predicate.value.length} exceeds maximum ${policy.maxArrayLength}`,
    code: 'POLICY_MAX_ARRAY_LENGTH_EXCEEDED',
  });
}

function evaluateRegexPolicy(
  predicate: FilterPredicate,
  policy: FilterPolicyOptions,
  errors: FilterValidationIssue[],
): void {
  if (predicate.operator !== 'regex') {
    return;
  }

  const rawPattern =
    predicate.value instanceof RegExp
      ? predicate.value.source
      : typeof predicate.value === 'string'
        ? predicate.value
        : undefined;

  if (!rawPattern) {
    return;
  }

  const regexPolicy = {
    ...DEFAULT_REGEX_POLICY,
    ...(policy.regex ?? {}),
  };
  const analysis = analyzeRegex(rawPattern);

  if (analysis.length > regexPolicy.maxLength) {
    errors.push(
      createRegexIssue(
        predicate,
        `Regex length ${analysis.length} exceeds maximum ${regexPolicy.maxLength}`,
        'POLICY_REGEX_LENGTH_EXCEEDED',
      ),
    );
  }

  if (analysis.groupCount > regexPolicy.maxGroupCount) {
    errors.push(
      createRegexIssue(
        predicate,
        `Regex group count ${analysis.groupCount} exceeds maximum ${regexPolicy.maxGroupCount}`,
        'POLICY_REGEX_GROUP_COUNT_EXCEEDED',
      ),
    );
  }

  if (analysis.alternationCount > regexPolicy.maxAlternationCount) {
    errors.push(
      createRegexIssue(
        predicate,
        `Regex alternation count ${analysis.alternationCount} exceeds maximum ${regexPolicy.maxAlternationCount}`,
        'POLICY_REGEX_ALTERNATION_EXCEEDED',
      ),
    );
  }

  if (analysis.quantifierCount > regexPolicy.maxQuantifierCount) {
    errors.push(
      createRegexIssue(
        predicate,
        `Regex quantifier count ${analysis.quantifierCount} exceeds maximum ${regexPolicy.maxQuantifierCount}`,
        'POLICY_REGEX_QUANTIFIER_EXCEEDED',
      ),
    );
  }

  if (analysis.complexityScore > regexPolicy.maxComplexityScore) {
    errors.push(
      createRegexIssue(
        predicate,
        `Regex complexity score ${analysis.complexityScore} exceeds maximum ${regexPolicy.maxComplexityScore}`,
        'POLICY_REGEX_COMPLEXITY_EXCEEDED',
      ),
    );
  }

  if (regexPolicy.denyNestedQuantifiers && analysis.hasNestedQuantifiers) {
    errors.push(
      createRegexIssue(
        predicate,
        'Regex contains nested quantifiers and is denied by policy',
        'POLICY_REGEX_NESTED_QUANTIFIER_DENIED',
      ),
    );
  }
}

function evaluateExpensiveOperatorPolicy(
  predicate: FilterPredicate,
  policy: FilterPolicyOptions,
  context: FilterPolicyContext | undefined,
  errors: FilterValidationIssue[],
): void {
  if (!policy.denyExpensiveOperatorsOnPublicEndpoints || !isPublicContext(context)) {
    return;
  }

  const expensiveOperators = new Set<FilterOperator>(
    (policy.expensiveOperators ?? [...DEFAULT_EXPENSIVE_OPERATORS]).map(
      (operator) => operator as FilterOperator,
    ),
  );

  if (!expensiveOperators.has(predicate.operator)) {
    return;
  }

  errors.push({
    field: predicate.field,
    operator: predicate.operator,
    message: `Operator '${predicate.operator}' is denied on public endpoints`,
    code: 'POLICY_EXPENSIVE_OPERATOR_DENIED',
  });
}

function collectPolicyPredicates(filter: FilterIR): FilterPredicate[] {
  const aggregation = getAggregationDefinition(filter);
  const sqlFeatures = getSqlFilterFeatures(filter);

  return [
    ...getPredicates(filter),
    ...(aggregation?.having ?? []),
    ...(sqlFeatures.caseExpressions ?? []).flatMap((expression) =>
      expression.cases.map((entry) => entry.when),
    ),
  ];
}

function isPublicContext(context: FilterPolicyContext | undefined): boolean {
  return (
    context?.isPublicEndpoint === true ||
    context?.endpointVisibility === 'public'
  );
}

function analyzeRegex(pattern: string): {
  length: number;
  groupCount: number;
  alternationCount: number;
  quantifierCount: number;
  charClassCount: number;
  complexityScore: number;
  hasNestedQuantifiers: boolean;
} {
  const groupCount = countMatches(pattern, /(?<!\\)\((?!\?)/g);
  const alternationCount = countMatches(pattern, /(?<!\\)\|/g);
  const quantifierCount = countMatches(pattern, /(?<!\\)(\*|\+|\?|\{\d+(?:,\d*)?\})/g);
  const charClassCount = countMatches(pattern, /(?<!\\)\[[^\]]*\]/g);
  const hasNestedQuantifiers =
    /(\([^)]*(\*|\+|\{[^}]+\})[^)]*\))(\*|\+|\{[^}]+\})/.test(pattern);
  const complexityScore =
    pattern.length +
    groupCount * 5 +
    alternationCount * 3 +
    quantifierCount * 4 +
    charClassCount * 2 +
    (hasNestedQuantifiers ? 20 : 0);

  return {
    length: pattern.length,
    groupCount,
    alternationCount,
    quantifierCount,
    charClassCount,
    complexityScore,
    hasNestedQuantifiers,
  };
}

function countMatches(input: string, pattern: RegExp): number {
  return [...input.matchAll(pattern)].length;
}

function createRegexIssue(
  predicate: FilterPredicate,
  message: string,
  code: string,
): FilterValidationIssue {
  return {
    field: predicate.field,
    operator: predicate.operator,
    value: predicate.value,
    message,
    code,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
