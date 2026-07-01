import {
  MongoParsedCondition,
  MongoValidationDependencies,
} from './mc-format-validation.types';

export function parseMongoQueryString(
  queryString: string,
  dependencies: MongoValidationDependencies,
): MongoParsedCondition[] {
  const conditions: MongoParsedCondition[] = [];
  const parts = queryString
    .split(/(?<!\\);/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('@')) {
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
