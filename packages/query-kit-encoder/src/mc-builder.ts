import type {
  AggregateMetric,
  MCOperator,
  PayloadBuildOptions,
  QueryPayload,
  QueryValue,
  RelationDirective,
  SortDefinition,
  URLSearchParamsOptions,
} from './types';
import {
  cloneRelationDirective,
  extractRelationPaths,
  formatAggregate,
  formatInlineSort,
  formatMCExternalSort,
  formatMCOperator,
  formatMCValue,
  relationDirectiveToSerializable,
} from './utils';

interface MCCondition {
  field: string;
  operator: MCOperator;
  value: QueryValue | QueryValue[] | Record<string, unknown>;
}

export class MCQueryBuilder {
  private readonly conditions: MCCondition[] = [];
  private readonly sort: SortDefinition[] = [];
  private readonly metrics: AggregateMetric[] = [];
  private readonly havingConditions: MCCondition[] = [];
  private relationDirective: RelationDirective | undefined;
  private relationKeyword: 'include' | 'populate' = 'populate';
  private projectionFields: string[] | undefined;
  private groupByFields: string[] | undefined;
  private limitValue: number | undefined;
  private pageValue: number | undefined;
  private offsetValue: number | undefined;

  where(
    field: string,
    operator: MCOperator,
    value: QueryValue | QueryValue[] | Record<string, unknown>,
  ): this {
    this.conditions.push({ field, operator, value });
    return this;
  }

  sortBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.sort.push({ field, direction });
    return this;
  }

  sortAsc(field: string): this {
    return this.sortBy(field, 'asc');
  }

  sortDesc(field: string): this {
    return this.sortBy(field, 'desc');
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  page(value: number): this {
    this.pageValue = value;
    return this;
  }

  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  fields(...fields: string[]): this {
    this.projectionFields = fields;
    return this;
  }

  include(...relations: string[]): this {
    this.relationKeyword = 'include';
    this.relationDirective = relations;
    return this;
  }

  populate(...relations: string[]): this {
    this.relationKeyword = 'populate';
    this.relationDirective = relations;
    return this;
  }

  relations(relations: RelationDirective, keyword: 'include' | 'populate' = 'populate'): this {
    this.relationDirective = cloneRelationDirective(relations);
    this.relationKeyword = keyword;
    return this;
  }

  aggregate(
    fn: AggregateMetric['fn'],
    field: string,
    alias: string,
  ): this {
    this.metrics.push({ fn, field, alias });
    return this;
  }

  groupBy(...fields: string[]): this {
    this.groupByFields = fields;
    return this;
  }

  having(
    field: string,
    operator: MCOperator,
    value: QueryValue | QueryValue[] | Record<string, unknown>,
  ): this {
    this.havingConditions.push({ field, operator, value });
    return this;
  }

  build(): string {
    return this.buildSegments().join(';');
  }

  buildPayload(options: PayloadBuildOptions = {}): QueryPayload {
    const {
      inlineSort = false,
      inlinePagination = false,
      inlineFields = false,
      inlineRelations = false,
    } = options;

    const segments = this.buildSegments({
      includeSort: inlineSort,
      includePagination: inlinePagination,
      includeFields: inlineFields,
      includeRelations: inlineRelations,
    });

    return {
      filterString: segments.join(';'),
      sortString:
        this.sort.length > 0 && !inlineSort
          ? formatMCExternalSort(this.sort)
          : undefined,
      page: !inlinePagination ? this.pageValue : undefined,
      size: !inlinePagination ? this.limitValue : undefined,
      offset: !inlinePagination ? this.offsetValue : undefined,
      fields: !inlineFields && this.projectionFields ? [...this.projectionFields] : undefined,
      relations:
        !inlineRelations && this.relationDirective
          ? cloneRelationDirective(this.relationDirective)
          : undefined,
      customInclude:
        !inlineRelations && this.relationDirective
          ? cloneRelationDirective(this.relationDirective)
          : undefined,
    };
  }

  toURLSearchParams(
    payloadOptions: PayloadBuildOptions = {},
    options: URLSearchParamsOptions = {},
  ): URLSearchParams {
    const payload = this.buildPayload(payloadOptions);
    const params = new URLSearchParams();

    params.set(options.filterKey ?? 'filter', payload.filterString);

    if (payload.sortString) {
      params.set(options.sortKey ?? 'sort', payload.sortString);
    }
    if (payload.page !== undefined) {
      params.set(options.pageKey ?? 'page', String(payload.page));
    }
    if (payload.size !== undefined) {
      params.set(options.sizeKey ?? 'size', String(payload.size));
    }
    if (payload.offset !== undefined) {
      params.set(options.offsetKey ?? 'offset', String(payload.offset));
    }
    if (payload.fields?.length) {
      params.set(options.fieldsKey ?? 'fields', payload.fields.join(','));
    }
    if (payload.relations) {
      const serialized =
        options.relationSerializer?.(payload.relations) ??
        relationDirectiveToSerializable(payload.relations);

      if (!serialized) {
        throw new Error('Complex relation directives require a custom relation serializer');
      }

      params.set(options.includeKey ?? 'include', serialized);
    }

    return params;
  }

  private buildSegments(options?: {
    includeSort?: boolean;
    includePagination?: boolean;
    includeFields?: boolean;
    includeRelations?: boolean;
  }): string[] {
    const {
      includeSort = true,
      includePagination = true,
      includeFields = true,
      includeRelations = true,
    } = options ?? {};
    const segments = this.conditions.map(
      (condition) =>
        `${condition.field}:${formatMCOperator(condition.operator)}:${formatMCValue(condition.operator, condition.value)}`,
    );

    if (includeSort && this.sort.length > 0) {
      segments.push(`@sort:${formatInlineSort(this.sort)}`);
    }

    if (includePagination) {
      if (this.limitValue !== undefined) {
        segments.push(`@limit:${this.limitValue}`);
      }
      if (this.pageValue !== undefined) {
        segments.push(`@page:${this.pageValue}`);
      }
      if (this.offsetValue !== undefined) {
        segments.push(`@offset:${this.offsetValue}`);
      }
    }

    if (includeFields && this.projectionFields?.length) {
      segments.push(`@fields:${this.projectionFields.join(',')}`);
    }

    if (includeRelations && this.relationDirective) {
      const paths = extractRelationPaths(this.relationDirective);
      if (!paths) {
        throw new Error('Inline relation directives only support string paths');
      }
      segments.push(`@${this.relationKeyword}:${paths.join(',')}`);
    }

    if (this.metrics.length > 0) {
      segments.push(`@aggregate:${this.metrics.map(formatAggregate).join(',')}`);
    }

    if (this.groupByFields?.length) {
      segments.push(`@groupBy:${this.groupByFields.join(',')}`);
    }

    for (const condition of this.havingConditions) {
      segments.push(
        `@having:${condition.field}:${formatMCOperator(condition.operator)}:${formatMCValue(condition.operator, condition.value)}`,
      );
    }

    return segments;
  }
}
