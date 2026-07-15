import type {
  ParsedCondition,
  ValidationDependencies,
} from './sc-format-validation.types';
import type {
  RawExpressionNode} from './sc-logical-expression.parser';
import {
  parseRawLogicalExpression,
  splitTopLevelSegments,
} from './sc-logical-expression.parser';

export interface ParsedPredicateNode {
  kind: 'predicate';
  predicate: ParsedCondition;
}

export interface ParsedLogicalGroupNode {
  kind: 'group';
  operator: 'and' | 'or';
  children: ParsedExpressionNode[];
}

export interface ParsedNotNode {
  kind: 'not';
  child: ParsedExpressionNode;
}

export type ParsedExpressionNode =
  | ParsedPredicateNode
  | ParsedLogicalGroupNode
  | ParsedNotNode;

export interface ParsedCaseWhenNode {
  condition: ParsedCondition;
  thenRawValue: string;
}

export interface ParsedCaseExpressionNode {
  outputField?: string;
  cases: ParsedCaseWhenNode[];
  elseRawValue?: string;
  error?: string;
}

export interface ParsedQueryDocument {
  conditions: ParsedCondition[];
  filterConditions: ParsedCondition[];
  caseConditions: ParsedCondition[];
  directiveSegments: string[];
  parsedHavingConditions: ParsedCondition[];
  caseExpressions: ParsedCaseExpressionNode[];
  expression?: ParsedExpressionNode;
}

export function parseQueryString(
  queryString: string,
  dependencies: ValidationDependencies,
): ParsedCondition[] {
  return parseQueryDocument(queryString, dependencies).conditions;
}

export function parseQueryDocument(
  queryString: string,
  dependencies: ValidationDependencies,
): ParsedQueryDocument {
  const directiveSegments: string[] = [];
  const parsedHavingConditions: ParsedCondition[] = [];
  const caseExpressions: ParsedCaseExpressionNode[] = [];
  let parts: string[];

  try {
    parts = splitTopLevelSegments(queryString).filter(Boolean);
  } catch (error) {
    return {
      conditions: [
        {
          raw: queryString,
          error: error instanceof Error ? error.message : 'Invalid logical expression',
        },
      ],
      filterConditions: [],
      caseConditions: [],
      directiveSegments: [],
      parsedHavingConditions: [],
      caseExpressions: [],
    };
  }

  const expressionSegments: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.startsWith('@')) {
      directiveSegments.push(part);

      const [rawDirective, ...rawValueParts] = part.split(/(?<!\\):/);
      if (rawDirective.slice(1).trim().toLowerCase() === 'having') {
        parsedHavingConditions.push(
          parsePredicate(rawValueParts.join(':').trim(), dependencies),
        );
      }

      continue;
    }

    if (part.startsWith('case:')) {
      const caseSegments = [part];

      while (index + 1 < parts.length) {
        const nextPart = parts[index + 1];
        if (!nextPart.startsWith('when:') && !nextPart.startsWith('else:')) {
          break;
        }
        caseSegments.push(nextPart);
        index += 1;
      }

      caseExpressions.push(parseCaseExpression(caseSegments, dependencies));
      continue;
    }

    expressionSegments.push(part);
  }

  const caseConditions = caseExpressions.flatMap((expression) =>
    expression.cases.map((entry) => entry.condition),
  );
  const filterConditions: ParsedCondition[] = [];
  let expression: ParsedExpressionNode | undefined;

  if (expressionSegments.length > 0) {
    try {
      expression = parseExpressionSegments(
        expressionSegments,
        dependencies,
        filterConditions,
      );
    } catch (error) {
      filterConditions.push({
        raw: expressionSegments.length === 1 ? expressionSegments[0] : '',
        error: error instanceof Error ? error.message : 'Invalid logical expression',
      });
    }
  }

  return {
    conditions: [...filterConditions, ...caseConditions],
    filterConditions,
    caseConditions,
    directiveSegments,
    parsedHavingConditions,
    caseExpressions,
    expression,
  };
}

function parsePredicate(
  raw: string,
  dependencies: ValidationDependencies,
): ParsedCondition {
  const match = raw.match(/^([^:]+):([^:]+):(.*)$/);
  if (!match) {
    return { raw, error: 'Invalid format' };
  }

  return {
    field: match[1].replace(/\\:/g, ':'),
    operator: dependencies.normalizeOperator(match[2]),
    rawValue: match[3],
    value: null,
  };
}

function parseCaseExpression(
  caseSegments: string[],
  dependencies: ValidationDependencies,
): ParsedCaseExpressionNode {
  const tokens = caseSegments[0].split(/(?<!\\):/);

  if (tokens.length < 2) {
    return {
      cases: [],
      error: 'CASE expression requires an output field: case:outputField',
    };
  }

  const expression: ParsedCaseExpressionNode = {
    outputField: tokens[1].replace(/\\:/g, ':').trim(),
    cases: [],
  };
  const inlineTokens = tokens.slice(2);

  if (inlineTokens.length > 0) {
    const inlineSegment = inlineTokens.join(':');
    if (inlineSegment.startsWith('when:')) {
      expression.cases.push(parseCaseWhenSegment(inlineSegment, dependencies));
    } else if (inlineSegment.startsWith('else:')) {
      expression.elseRawValue = inlineSegment.slice(5).trim();
    } else {
      expression.error = `Invalid CASE segment "${caseSegments[0]}"`;
      return expression;
    }
  }

  for (let index = 1; index < caseSegments.length; index += 1) {
    const segment = caseSegments[index];

    if (segment.startsWith('when:')) {
      expression.cases.push(parseCaseWhenSegment(segment, dependencies));
      continue;
    }

    if (segment.startsWith('else:')) {
      expression.elseRawValue = segment.slice(5).trim();
    }
  }

  if (expression.cases.length === 0 && !expression.error) {
    expression.error = `CASE expression "${expression.outputField}" must contain at least one when/then pair`;
  }

  return expression;
}

function parseCaseWhenSegment(
  segment: string,
  dependencies: ValidationDependencies,
): ParsedCaseWhenNode {
  const tokens = segment.split(/(?<!\\):/).map((token) => token.replace(/\\:/g, ':'));
  const thenIndex = tokens.findIndex((token) => token === 'then');

  if (tokens.length < 6 || tokens[0] !== 'when' || thenIndex < 4 || thenIndex === tokens.length - 1) {
    return {
      condition: {
        raw: segment,
        error:
          thenIndex < 4 || thenIndex === tokens.length - 1
            ? 'Invalid CASE condition format'
            : 'Invalid CASE condition format',
      },
      thenRawValue: '',
    };
  }

  return {
    condition: {
      field: tokens[1].trim(),
      operator: dependencies.normalizeOperator(tokens[2]),
      rawValue: tokens.slice(3, thenIndex).join(':').trim(),
      value: null,
    },
    thenRawValue: tokens.slice(thenIndex + 1).join(':').trim(),
  };
}

function mapRawExpression(
  expression: RawExpressionNode,
  dependencies: ValidationDependencies,
  filterConditions: ParsedCondition[],
): ParsedExpressionNode {
  switch (expression.kind) {
    case 'predicate': {
      const predicate = parsePredicate(expression.raw, dependencies);
      filterConditions.push(predicate);
      return {
        kind: 'predicate',
        predicate,
      };
    }
    case 'not':
      return {
        kind: 'not',
        child: mapRawExpression(expression.child, dependencies, filterConditions),
      };
    case 'group':
      return {
        kind: 'group',
        operator: expression.operator,
        children: expression.children.map((child) =>
          mapRawExpression(child, dependencies, filterConditions),
        ),
      };
  }
}

function parseExpressionSegments(
  expressionSegments: string[],
  dependencies: ValidationDependencies,
  filterConditions: ParsedCondition[],
): ParsedExpressionNode | undefined {
  if (expressionSegments.length === 0) {
    return undefined;
  }

  if (expressionSegments.length === 1) {
    return parseExpressionSegment(expressionSegments[0], dependencies, filterConditions);
  }

  return {
    kind: 'group',
    operator: 'and',
    children: expressionSegments.map((segment) =>
      parseExpressionSegment(segment, dependencies, filterConditions),
    ),
  };
}

function parseExpressionSegment(
  segment: string,
  dependencies: ValidationDependencies,
  filterConditions: ParsedCondition[],
): ParsedExpressionNode {
  const rawExpression = parseRawLogicalExpression(segment);

  if (!rawExpression) {
    throw new Error('Logical expression cannot be empty');
  }

  return mapRawExpression(rawExpression, dependencies, filterConditions);
}
