import { FilterValidationIssue } from '../contracts';
import {
  AggregationExpression,
  FilterIR,
  getAggregationDefinition,
  getProjectionFields,
  getSorting,
  NormalizedFilter,
} from './filter-ir.interface';

export function validateFilterIrSemantics(
  filter: FilterIR | NormalizedFilter,
): FilterValidationIssue[] {
  const issues: FilterValidationIssue[] = [];
  const aggregation = getAggregationDefinition(filter);

  if (!aggregation) {
    return issues;
  }

  const groupByFields = aggregation.groupBy ?? [];
  const metricAliases = aggregation.metrics.map((metric) =>
    getMetricAlias(metric),
  );
  const selectableFields = new Set<string>([...groupByFields, ...metricAliases]);

  assertUniqueValues(groupByFields, 'groupBy', issues, 'DUPLICATE_GROUP_BY_FIELD');
  assertUniqueValues(
    metricAliases,
    'aggregation',
    issues,
    'DUPLICATE_AGGREGATION_ALIAS',
  );

  aggregation.metrics.forEach((metric) => {
    validateMetric(metric, issues);
  });

  if (
    aggregation.having?.length &&
    selectableFields.size === 0
  ) {
    issues.push({
      field: 'aggregation.having',
      message: 'HAVING requires at least one groupBy field or aggregation metric',
      code: 'HAVING_WITHOUT_AGGREGATION',
    });
  }

  aggregation.having?.forEach((predicate) => {
    if (!selectableFields.has(predicate.field)) {
      issues.push({
        field: predicate.field,
        operator: predicate.operator,
        value: predicate.value,
        message:
          `HAVING field "${predicate.field}" must reference a groupBy field or aggregation alias`,
        code: 'INVALID_HAVING_FIELD',
      });
    }
  });

  const projectionFields = getProjectionFields(filter) ?? [];
  projectionFields.forEach((field) => {
    if (!selectableFields.has(field)) {
      issues.push({
        field,
        message:
          `Projected field "${field}" must reference a groupBy field or aggregation alias when aggregation is active`,
        code: 'INVALID_AGGREGATION_PROJECTION',
      });
    }
  });

  getSorting(filter).forEach((item) => {
    if (!selectableFields.has(item.field)) {
      issues.push({
        field: item.field,
        message:
          `Sort field "${item.field}" must reference a groupBy field or aggregation alias when aggregation is active`,
        code: 'INVALID_AGGREGATION_SORT',
      });
    }
  });

  return issues;
}

function validateMetric(
  metric: AggregationExpression,
  issues: FilterValidationIssue[],
): void {
  if (metric.operator !== 'count' && !metric.field) {
    issues.push({
      field: metric.alias ?? metric.operator,
      operator: metric.operator,
      message: `Aggregation operator "${metric.operator}" requires a source field`,
      code: 'AGGREGATION_FIELD_REQUIRED',
    });
  }
}

function getMetricAlias(metric: AggregationExpression): string {
  return metric.alias ?? `${metric.operator}_${metric.field ?? 'all'}`;
}

function assertUniqueValues(
  values: string[],
  field: string,
  issues: FilterValidationIssue[],
  code: string,
): void {
  const seen = new Set<string>();

  values.forEach((value) => {
    if (seen.has(value)) {
      issues.push({
        field,
        value,
        message: `Duplicate value "${value}" is not allowed`,
        code,
      });
      return;
    }

    seen.add(value);
  });
}
