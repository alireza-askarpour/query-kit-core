import {
  ParsedCondition,
  ValidationDependencies,
} from './sc-format-validation.types';

export function parseQueryString(
  queryString: string,
  dependencies: ValidationDependencies,
): ParsedCondition[] {
  const conditions: ParsedCondition[] = [];
  const parts = queryString
    .split(/(?<!\\);/)
    .map((part) => part.trim())
    .filter(Boolean);

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

    const match = part.match(/^([^:]+):([^:]+):(.*)$/);
    if (!match) {
      conditions.push({ raw: part, error: 'Invalid format' });
      continue;
    }

    conditions.push({
      field: match[1].replace(/\\:/g, ':'),
      operator: dependencies.normalizeOperator(match[2]),
      rawValue: match[3],
      value: null,
    });
  }

  return conditions;
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
