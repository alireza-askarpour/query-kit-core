import { BadRequestException } from '@nestjs/common';
import {
  AggregateDefinition,
  FilterPredicate,
  AggregationExpression,
} from '../core';

export function parseAggregationDirective(
  value: string,
  parseList: (value: string, label: string) => string[],
  label: string,
): AggregationExpression[] {
  const items = parseList(value, label);

  return items.map((item) => parseAggregationMetric(item));
}

export function parseGroupByDirective(
  value: string,
  parseList: (value: string, label: string) => string[],
  label: string,
): string[] {
  return parseList(value, label);
}

export function buildAggregationDefinition(
  metrics: AggregationExpression[],
  groupBy?: string[],
  having?: FilterPredicate[],
): AggregateDefinition | undefined {
  if (
    metrics.length === 0 &&
    (!groupBy || groupBy.length === 0) &&
    (!having || having.length === 0)
  ) {
    return undefined;
  }

  return {
    metrics,
    groupBy: groupBy?.length ? groupBy : undefined,
    having: having?.length ? having : undefined,
  };
}

export function parseHavingDirective(
  value: string,
  parsePredicate: (value: string) => FilterPredicate,
  label: string,
): FilterPredicate {
  if (!value.trim()) {
    throw new BadRequestException(`${label} requires a predicate value`);
  }

  return parsePredicate(value.trim());
}

export function getAggregationMetricAlias(metric: AggregationExpression): string {
  return metric.alias ?? createDefaultAlias(metric.operator, metric.field);
}

function parseAggregationMetric(item: string): AggregationExpression {
  const match = item.match(
    /^(count|sum|avg|min|max)\(([^)]*)\)(?::([A-Za-z_][A-Za-z0-9_]*))?$/i,
  );

  if (!match) {
    throw new BadRequestException(
      `Invalid aggregation metric "${item}". Expected operator(field):alias`,
    );
  }

  const operator = match[1].toLowerCase() as AggregationExpression['operator'];
  const rawField = match[2].trim();
  const field = rawField === '*' || rawField === '' ? undefined : rawField;
  const alias = match[3]?.trim() || createDefaultAlias(operator, field);

  if (operator === 'count') {
    return { operator, field, alias };
  }

  if (!field) {
    throw new BadRequestException(
      `Aggregation operator "${operator}" requires a field name`,
    );
  }

  return { operator, field, alias };
}

function createDefaultAlias(
  operator: AggregationExpression['operator'],
  field?: string,
): string {
  const normalizedField = field?.replace(/[^a-zA-Z0-9]+/g, '_') ?? 'all';
  return `${operator}_${normalizedField}`;
}
