import {
  ParsedCondition,
  ValidationDependencies,
} from './sc-format-validation.types';
import {
  flattenRawPredicates,
  parseRawLogicalExpression,
  splitTopLevelSegments,
} from './sc-logical-expression.parser';

export function parseQueryString(
  queryString: string,
  dependencies: ValidationDependencies,
): ParsedCondition[] {
  const conditions: ParsedCondition[] = [];
  let parts: string[];

  try {
    parts = splitTopLevelSegments(queryString).filter(Boolean);
  } catch (error) {
    return [
      {
        raw: queryString,
        error: error instanceof Error ? error.message : 'Invalid logical expression',
      },
    ];
  }

  const expressionSegments: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.startsWith('@')) {
      continue;
    }

    if (part.startsWith('case:')) {
      const caseSegments: string[] = [];
      const inlineSegment = part.split(/(?<!\\):/).slice(2).join(':');

      if (inlineSegment) {
        caseSegments.push(inlineSegment);
      }

      while (index + 1 < parts.length) {
        const nextPart = parts[index + 1];
        if (!nextPart.startsWith('when:') && !nextPart.startsWith('else:')) {
          break;
        }
        caseSegments.push(nextPart);
        index += 1;
      }

      parseCaseSegments(caseSegments, conditions, dependencies);
      continue;
    }

    expressionSegments.push(part);
  }

  if (expressionSegments.length === 0) {
    return conditions;
  }

  try {
    const expression = parseRawLogicalExpression(expressionSegments.join(';'));

    if (!expression) {
      return conditions;
    }

    for (const predicate of flattenRawPredicates(expression)) {
      conditions.push(parsePredicate(predicate.raw, dependencies));
    }
  } catch (error) {
    conditions.push({
      raw: expressionSegments.join(';'),
      error: error instanceof Error ? error.message : 'Invalid logical expression',
    });
  }

  return conditions;
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

function parseCaseSegments(
  caseSegments: string[],
  conditions: ParsedCondition[],
  dependencies: ValidationDependencies,
): void {
  for (const caseSegment of caseSegments) {
    if (!caseSegment.startsWith('when:')) {
      continue;
    }

    const match = caseSegment.match(/^when:([^:]+):([^:]+):(.*):then:(.*)$/);

    if (!match) {
      conditions.push({
        raw: caseSegment,
        error: 'Invalid CASE condition format',
      });
      continue;
    }

    conditions.push({
      field: match[1].replace(/\\:/g, ':'),
      operator: dependencies.normalizeOperator(match[2]),
      rawValue: match[3],
      value: null,
    });
  }
}
