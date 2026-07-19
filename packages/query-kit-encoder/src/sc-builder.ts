import type {
  AggregateMetric,
  CaseWhenDefinition,
  PayloadBuildOptions,
  QueryPayload,
  QueryValue,
  RelationDirective,
  SCOperator,
  SortDefinition,
  URLSearchParamsOptions,
} from './types';
import {
  cloneRelationDirective,
  extractRelationPaths,
  formatAggregate,
  formatInlineSort,
  formatPrimitive,
  formatSCExternalSort,
  formatSCValue,
  relationDirectiveToSerializable,
} from './utils';

interface ConditionNode {
  field: string;
  operator: SCOperator;
  value: QueryValue | QueryValue[];
}

interface ConditionEntry {
  joiner: 'and' | 'or';
  node: ConditionNode | ConditionGroupNode | NotNode;
}

interface ConditionGroupNode {
  type: 'group';
  items: ConditionEntry[];
}

interface NotNode {
  type: 'not';
  node: ConditionNode | ConditionGroupNode;
}

class CaseExpressionBuilder {
  private readonly whens: CaseWhenDefinition[] = [];
  private elseValue?: QueryValue;

  constructor(private readonly outputField: string) {}

  when(
    field: string,
    operator: SCOperator,
    value: QueryValue | QueryValue[],
    result: QueryValue,
  ): this {
    this.whens.push({ field, operator, value, result });
    return this;
  }

  else(value: QueryValue): this {
    this.elseValue = value;
    return this;
  }

  build(): string {
    const parts = [`case:${this.outputField}`];

    for (const item of this.whens) {
      parts.push(
        `when:${item.field}:${item.operator}:${formatSCValue(item.operator, item.value)}:then:${formatPrimitive(item.result)}`,
      );
    }

    if (this.elseValue !== undefined) {
      parts.push(`else:${formatPrimitive(this.elseValue)}`);
    }

    return parts.join(';');
  }
}

class SCConditionComposer {
  protected readonly root: ConditionGroupNode = {
    type: 'group',
    items: [],
  };

  where(field: string, operator: SCOperator, value: QueryValue | QueryValue[]): this {
    return this.push('and', { field, operator, value });
  }

  orWhere(field: string, operator: SCOperator, value: QueryValue | QueryValue[]): this {
    return this.push('or', { field, operator, value });
  }

  andGroup(callback: (builder: SCConditionComposer) => void): this {
    return this.push('and', this.createGroup(callback));
  }

  orGroup(callback: (builder: SCConditionComposer) => void): this {
    return this.push('or', this.createGroup(callback));
  }

  not(callback: (builder: SCConditionComposer) => void): this {
    const group = this.createGroup(callback);
    return this.push('and', { type: 'not', node: group });
  }

  protected renderExpression(): string {
    return renderGroup(this.root);
  }

  private createGroup(callback: (builder: SCConditionComposer) => void): ConditionGroupNode {
    const builder = new SCConditionComposer();
    callback(builder);

    if (builder.root.items.length === 0) {
      throw new Error('Logical group cannot be empty');
    }

    return builder.root;
  }

  private push(
    joiner: 'and' | 'or',
    node: ConditionNode | ConditionGroupNode | NotNode,
  ): this {
    this.root.items.push({ joiner, node });
    return this;
  }
}

export class SCQueryBuilder extends SCConditionComposer {
  private readonly sort: SortDefinition[] = [];
  private readonly metrics: AggregateMetric[] = [];
  private readonly havingConditions: ConditionNode[] = [];
  private readonly caseExpressions: string[] = [];
  private includeDirective: RelationDirective | undefined;
  private projectionFields: string[] | undefined;
  private groupByFields: string[] | undefined;
  private limitValue: number | undefined;
  private pageValue: number | undefined;
  private offsetValue: number | undefined;

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
    this.includeDirective = relations;
    return this;
  }

  relations(relations: RelationDirective): this {
    this.includeDirective = cloneRelationDirective(relations);
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
    operator: SCOperator,
    value: QueryValue | QueryValue[],
  ): this {
    this.havingConditions.push({ field, operator, value });
    return this;
  }

  case(
    outputField: string,
    callback: (builder: CaseExpressionBuilder) => void,
  ): this {
    const builder = new CaseExpressionBuilder(outputField);
    callback(builder);
    this.caseExpressions.push(builder.build());
    return this;
  }

  build(): string {
    const segments: string[] = [];
    const expression = this.renderExpression();

    if (expression) {
      segments.push(expression);
    }

    segments.push(...this.caseExpressions);
    segments.push(...this.buildInlineDirectiveSegments());

    return segments.filter(Boolean).join(';');
  }

  buildPayload(options: PayloadBuildOptions = {}): QueryPayload {
    const {
      inlineSort = false,
      inlinePagination = false,
      inlineFields = false,
      inlineRelations = false,
    } = options;

    const segments: string[] = [];
    const expression = this.renderExpression();

    if (expression) {
      segments.push(expression);
    }

    segments.push(...this.caseExpressions);
    segments.push(
      ...this.buildInlineDirectiveSegments({
        includeSort: inlineSort,
        includePagination: inlinePagination,
        includeFields: inlineFields,
        includeRelations: inlineRelations,
      }),
    );

    return {
      filterString: segments.join(';'),
      sortString:
        this.sort.length > 0 && !inlineSort
          ? formatSCExternalSort(this.sort)
          : undefined,
      page: !inlinePagination ? this.pageValue : undefined,
      size: !inlinePagination ? this.limitValue : undefined,
      offset: !inlinePagination ? this.offsetValue : undefined,
      fields: !inlineFields && this.projectionFields ? [...this.projectionFields] : undefined,
      relations:
        !inlineRelations && this.includeDirective
          ? cloneRelationDirective(this.includeDirective)
          : undefined,
      customInclude:
        !inlineRelations && this.includeDirective
          ? cloneRelationDirective(this.includeDirective)
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

  private buildInlineDirectiveSegments(options?: {
    includeSort?: boolean;
    includePagination?: boolean;
    includeFields?: boolean;
    includeRelations?: boolean;
  }): string[] {
    const segments: string[] = [];
    const {
      includeSort = true,
      includePagination = true,
      includeFields = true,
      includeRelations = true,
    } = options ?? {};

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

    if (includeRelations && this.includeDirective) {
      const paths = extractRelationPaths(this.includeDirective);
      if (!paths) {
        throw new Error('Inline relation directives only support string paths');
      }
      segments.push(`@include:${paths.join(',')}`);
    }

    if (this.metrics.length > 0) {
      segments.push(`@aggregate:${this.metrics.map(formatAggregate).join(',')}`);
    }

    if (this.groupByFields?.length) {
      segments.push(`@groupBy:${this.groupByFields.join(',')}`);
    }

    for (const condition of this.havingConditions) {
      segments.push(
        `@having:${condition.field}:${condition.operator}:${formatSCValue(condition.operator, condition.value)}`,
      );
    }

    return segments;
  }
}

function renderGroup(group: ConditionGroupNode): string {
  return group.items
    .map((entry, index) => {
      const separator = index === 0 ? '' : entry.joiner === 'and' ? ';' : '|';
      return `${separator}${renderNode(entry.node)}`;
    })
    .join('');
}

function renderNode(node: ConditionNode | ConditionGroupNode | NotNode): string {
  if ('type' in node && node.type === 'group') {
    return `(${renderGroup(node)})`;
  }

  if ('type' in node && node.type === 'not') {
    const rendered = renderNode(node.node);
    return `!${rendered}`;
  }

  return `${node.field}:${node.operator}:${formatSCValue(node.operator, node.value)}`;
}
