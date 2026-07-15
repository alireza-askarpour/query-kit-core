import type {
  MongoParsedCondition,
  MongoValidationDependencies,
} from './mc-format-validation.types';

export interface MongoParsedDirectiveSegment {
  raw: string;
  rawName: string;
  name: string;
  value: string;
  havingCondition?: MongoParsedCondition;
}

export interface MongoParsedQueryDocument {
  conditions: MongoParsedCondition[];
  filterConditions: MongoParsedCondition[];
  directiveSegments: string[];
  directives: MongoParsedDirectiveSegment[];
  parsedHavingConditions: MongoParsedCondition[];
}

export function parseMongoQueryString(
  queryString: string,
  dependencies: MongoValidationDependencies,
): MongoParsedCondition[] {
  return parseMongoQueryDocument(queryString, dependencies).conditions;
}

export function parseMongoQueryDocument(
  queryString: string,
  dependencies: MongoValidationDependencies,
): MongoParsedQueryDocument {
  const filterConditions: MongoParsedCondition[] = [];
  const directiveSegments: string[] = [];
  const directives: MongoParsedDirectiveSegment[] = [];
  const parsedHavingConditions: MongoParsedCondition[] = [];
  const parts = splitEscapedSegments(queryString, ';');

  for (const part of parts) {
    if (part.startsWith('@')) {
      directiveSegments.push(part);
      const directive = parseMongoDirectiveSegment(part, dependencies);
      directives.push(directive);

      if (directive.havingCondition) {
        parsedHavingConditions.push(directive.havingCondition);
      }

      continue;
    }

    filterConditions.push(parseMongoCondition(part, dependencies));
  }

  return {
    conditions: filterConditions,
    filterConditions,
    directiveSegments,
    directives,
    parsedHavingConditions,
  };
}

export function parseMongoCondition(
  rawCondition: string,
  dependencies: MongoValidationDependencies,
): MongoParsedCondition {
  const firstColon = findUnescapedCharacter(rawCondition, ':');
  if (firstColon < 0) {
    return { raw: rawCondition, error: 'Invalid format' };
  }

  const secondColon = findUnescapedCharacter(rawCondition, ':', firstColon + 1);
  if (secondColon < 0) {
    return { raw: rawCondition, error: 'Invalid format' };
  }

  const field = unescapeCharacter(rawCondition.slice(0, firstColon), ':');
  const rawOperator = unescapeCharacter(
    rawCondition.slice(firstColon + 1, secondColon),
    ':',
  );

  return {
    field,
    operator: dependencies.normalizeOperator(rawOperator),
    rawValue: rawCondition.slice(secondColon + 1),
    value: null,
  };
}

export function parseMongoDirectiveSegment(
  rawSegment: string,
  dependencies?: MongoValidationDependencies,
): MongoParsedDirectiveSegment {
  const separatorIndex = findUnescapedCharacter(rawSegment, ':');
  const rawName =
    separatorIndex >= 0
      ? unescapeCharacter(rawSegment.slice(0, separatorIndex), ':')
      : unescapeCharacter(rawSegment, ':');
  const name = rawName.slice(1).trim().toLowerCase();
  const value =
    separatorIndex >= 0 ? rawSegment.slice(separatorIndex + 1).trim() : '';
  const directive: MongoParsedDirectiveSegment = {
    raw: rawSegment,
    rawName,
    name,
    value,
  };

  if (name === 'having' && dependencies) {
    directive.havingCondition = parseMongoCondition(value, dependencies);
  }

  return directive;
}

export function splitEscapedSegments(input: string, separator: string): string[] {
  const segments: string[] = [];
  let segmentStart = 0;
  let current = '';
  let sawEscape = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === '\\') {
      const nextChar = input[index + 1];

      if (nextChar === separator) {
        if (!sawEscape) {
          current = input.slice(segmentStart, index);
          sawEscape = true;
        }
        current += separator;
        index += 1;
        segmentStart = index + 1;
        continue;
      }

      if (sawEscape) {
        current += char;
      }
      continue;
    }

    if (char !== separator) {
      if (sawEscape) {
        current += char;
      }
      continue;
    }

    const rawSegment = sawEscape
      ? current + input.slice(segmentStart, index)
      : input.slice(segmentStart, index);
    const segment = rawSegment.trim();
    if (segment) {
      segments.push(segment);
    }
    current = '';
    sawEscape = false;
    segmentStart = index + 1;
  }

  const trailingSegment = sawEscape
    ? current + input.slice(segmentStart)
    : input.slice(segmentStart);
  const segment = trailingSegment.trim();
  if (segment) {
    segments.push(segment);
  }

  return segments;
}

export function parseEscapedList(value: string): string[] {
  return splitEscapedSegments(value, ',');
}

function findUnescapedCharacter(
  input: string,
  target: string,
  startIndex = 0,
): number {
  let escaped = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === target) {
      return index;
    }
  }

  return -1;
}

function unescapeCharacter(input: string, target: string): string {
  if (!input.includes(`\\${target}`)) {
    return input;
  }

  let result = '';

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === '\\' && input[index + 1] === target) {
      result += target;
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}
