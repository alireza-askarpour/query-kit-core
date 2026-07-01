export interface RawPredicateNode {
  kind: 'predicate';
  raw: string;
}

export interface RawLogicalGroupNode {
  kind: 'group';
  operator: 'and' | 'or';
  children: RawExpressionNode[];
}

export interface RawNotNode {
  kind: 'not';
  child: RawExpressionNode;
}

export type RawExpressionNode =
  | RawPredicateNode
  | RawLogicalGroupNode
  | RawNotNode;

export function splitTopLevelSegments(
  input: string,
  separator = ';',
): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let escaped = false;

  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      current += character;
      escaped = true;
      continue;
    }

    if (character === '(') {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      if (depth < 0) {
        throw new Error('Unexpected closing parenthesis in SC filter');
      }
      current += character;
      continue;
    }

    if (character === separator && depth === 0) {
      segments.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (depth !== 0) {
    throw new Error('Unbalanced parentheses in SC filter');
  }

  segments.push(current.trim());

  return segments;
}

export function parseRawLogicalExpression(
  input: string,
): RawExpressionNode | undefined {
  const normalized = input.trim();
  if (!normalized) {
    return undefined;
  }

  return parseOrExpression(normalized);
}

export function flattenRawPredicates(
  expression: RawExpressionNode,
): RawPredicateNode[] {
  switch (expression.kind) {
    case 'predicate':
      return [expression];
    case 'not':
      return flattenRawPredicates(expression.child);
    case 'group':
      return expression.children.flatMap((child) => flattenRawPredicates(child));
    default:
      return assertNever(expression);
  }
}

function parseOrExpression(input: string): RawExpressionNode {
  const parts = splitTopLevelSegments(input, '|');

  if (parts.length === 1) {
    return parseAndExpression(parts[0]);
  }

  return {
    kind: 'group',
    operator: 'or',
    children: parts.map((part) => parseAndExpression(assertNonEmpty(part, '|'))),
  };
}

function parseAndExpression(input: string): RawExpressionNode {
  const parts = splitTopLevelSegments(input, ';');

  if (parts.length === 1) {
    return parseUnaryExpression(parts[0]);
  }

  return {
    kind: 'group',
    operator: 'and',
    children: parts.map((part) => parseUnaryExpression(assertNonEmpty(part, ';'))),
  };
}

function parseUnaryExpression(input: string): RawExpressionNode {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error('Empty expression is not allowed in SC filter');
  }

  if (normalized.startsWith('!')) {
    const operand = normalized.slice(1).trim();
    return {
      kind: 'not',
      child: parseUnaryExpression(assertNonEmpty(operand, '!')),
    };
  }

  if (isWrappedByOuterParentheses(normalized)) {
    return parseOrExpression(normalized.slice(1, -1).trim());
  }

  return {
    kind: 'predicate',
    raw: normalized,
  };
}

function isWrappedByOuterParentheses(input: string): boolean {
  if (!input.startsWith('(') || !input.endsWith(')')) {
    return false;
  }

  let depth = 0;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      if (depth === 0 && index < input.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function assertNonEmpty(value: string, operator: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Missing operand around "${operator}" in SC filter`);
  }

  return normalized;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled raw expression node: ${JSON.stringify(value)}`);
}
