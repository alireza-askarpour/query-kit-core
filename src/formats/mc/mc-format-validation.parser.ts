import {
  MongoParsedCondition,
  MongoValidationDependencies,
} from './mc-format-validation.types';

export interface MongoParsedQueryDocument {
  conditions: MongoParsedCondition[];
  filterConditions: MongoParsedCondition[];
  directiveSegments: string[];
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
  const parsedHavingConditions: MongoParsedCondition[] = [];
  const parts = queryString
    .split(/(?<!\\);/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('@')) {
      directiveSegments.push(part);

      const [rawDirective, ...rawValueParts] = part.split(/(?<!\\):/);
      const directive = rawDirective.slice(1).trim().toLowerCase();

      if (directive === 'having') {
        parsedHavingConditions.push(
          parseMongoCondition(rawValueParts.join(':').trim(), dependencies),
        );
      }

      continue;
    }

    filterConditions.push(parseMongoCondition(part, dependencies));
  }

  return {
    conditions: filterConditions,
    filterConditions,
    directiveSegments,
    parsedHavingConditions,
  };
}

function parseMongoCondition(
  rawCondition: string,
  dependencies: MongoValidationDependencies,
): MongoParsedCondition {
  const match = rawCondition.match(/^([^:]+):([^:]+):(.*)$/);
  if (!match) {
    return { raw: rawCondition, error: 'Invalid format' };
  }

  return {
    field: match[1].replace(/\\:/g, ':'),
    operator: dependencies.normalizeOperator(match[2]),
    rawValue: match[3],
    value: null,
  };
}
