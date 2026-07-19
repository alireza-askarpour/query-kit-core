import type {
  AggregateMetric,
  ListValue,
  MCOperator,
  QueryValue,
  RelationDefinition,
  RelationDirective,
  SCOperator,
  SortDefinition,
} from './types';

export function escapeQueryStringValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function formatPrimitive(value: QueryValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null) {
    return 'null';
  }

  return escapeQueryStringValue(String(value));
}

export function formatList(values: ListValue): string {
  return values.map((value) => formatPrimitive(value)).join(',');
}

export function formatSCValue(
  operator: SCOperator,
  value: QueryValue | ListValue,
): string {
  if (operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error('SC "between" requires exactly two values');
    }
    return formatList(value);
  }

  if (['in', 'notIn', 'any', 'all'].includes(operator)) {
    if (!Array.isArray(value)) {
      throw new Error(`SC "${operator}" requires an array value`);
    }
    return formatList(value);
  }

  return Array.isArray(value) ? formatList(value) : formatPrimitive(value);
}

export function formatMCOperator(operator: MCOperator): string {
  return operator.startsWith('$') ? operator : `$${operator}`;
}

export function formatMCValue(
  operator: MCOperator,
  value: QueryValue | ListValue | Record<string, unknown>,
): string {
  const normalizedOperator = operator.startsWith('$') ? operator.slice(1) : operator;

  if (normalizedOperator === 'elemMatch') {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      value instanceof Date
    ) {
      throw new Error('MC "elemMatch" requires an object value');
    }

    return JSON.stringify(value);
  }

  if (['in', 'notIn', 'all'].includes(normalizedOperator)) {
    if (!Array.isArray(value)) {
      throw new Error(`MC "${normalizedOperator}" requires an array value`);
    }
    return formatList(value);
  }

  return Array.isArray(value) ? formatList(value) : formatPrimitive(value as QueryValue);
}

export function formatInlineSort(sort: SortDefinition[]): string {
  return sort
    .map((item) => (item.direction === 'desc' ? `-${item.field}` : item.field))
    .join(',');
}

export function formatSCExternalSort(sort: SortDefinition[]): string {
  return sort
    .map((item) => `${item.field}:${item.direction}`)
    .join(';');
}

export function formatMCExternalSort(sort: SortDefinition[]): string {
  return formatInlineSort(sort);
}

export function formatAggregate(metric: AggregateMetric): string {
  return `${metric.fn}(${metric.field}):${metric.alias}`;
}

export function extractRelationPaths(
  relations?: RelationDirective,
): string[] | undefined {
  if (!relations) {
    return undefined;
  }

  const items = Array.isArray(relations) ? relations : [relations];
  const paths: string[] = [];

  for (const item of items) {
    if (typeof item !== 'string') {
      return undefined;
    }
    paths.push(item);
  }

  return paths;
}

export function relationDirectiveToSerializable(
  relations?: RelationDirective,
): string | undefined {
  const paths = extractRelationPaths(relations);
  if (!paths) {
    return undefined;
  }
  return paths.join(',');
}

export function cloneRelationDirective(
  relations?: RelationDirective,
): RelationDirective | undefined {
  if (!relations) {
    return undefined;
  }

  if (typeof relations === 'string') {
    return relations;
  }

  if (!Array.isArray(relations)) {
    return cloneRelationDefinition(relations);
  }

  return relations.map((item) =>
    typeof item === 'string' ? item : cloneRelationDefinition(item),
  );
}

function cloneRelationDefinition(
  relation: RelationDefinition,
): RelationDefinition {
  return {
    path: relation.path,
    fields: relation.fields ? [...relation.fields] : undefined,
    nested: cloneRelationDirective(relation.nested),
    required: relation.required,
  };
}
