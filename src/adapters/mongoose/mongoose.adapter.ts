import { Injectable } from '@nestjs/common';
import {
  AdapterOperatorPlugin,
  AggregateDefinition,
  AggregationExpression,
  FilterIR,
  FilterExpressionNode,
  getAggregationDefinition,
  getFilterExpression,
  getPagination,
  getPredicates,
  getProjectionFields,
  getRelations,
  getSorting,
  hasComplexLogicalExpression,
  normalizeRelationDirectives,
  NormalizedCondition,
  QueryAdapter,
  RelationDefinition,
} from '../../core';
import { getDefaultFilterOperatorRegistry } from '../../core';

export interface MongoosePopulateDefinition {
  path: string;
  select?: string | string[];
  populate?: MongoosePopulateDefinition | MongoosePopulateDefinition[];
}

export interface MongooseModelLike<TResult = unknown> {
  find(
    filter?: Record<string, unknown>,
    projection?: string | Record<string, 0 | 1>,
  ): MongooseQueryLike<TResult>;
  aggregate?(pipeline?: Record<string, unknown>[]): MongooseAggregateLike<TResult>;
}

export interface MongooseQueryLike<TResult = unknown> {
  sort(sort: Record<string, 1 | -1>): this;
  limit(limit: number): this;
  skip(offset: number): this;
  select(fields: string | Record<string, 0 | 1>): this;
  populate(
    definition:
      | string
      | MongoosePopulateDefinition
      | Array<string | MongoosePopulateDefinition>,
  ): this;
}

export interface MongooseAggregateLike<TResult = unknown> {
  sort(sort: Record<string, 1 | -1>): this;
  limit(limit: number): this;
  skip(offset: number): this;
  project(projection: Record<string, unknown>): this;
}

export interface MongooseAdapterOptions<TResult = unknown> {
  model: MongooseModelLike<TResult>;
  fieldMap?: Record<string, string>;
  populateMap?: Record<string, MongoosePopulateDefinition | string>;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface MongooseOperatorPluginContext<TResult = unknown> {
  field: string;
  operator: string;
  value: unknown;
  options: MongooseAdapterOptions<TResult>;
}

export interface MongooseCustomOperatorPlugin<TResult = unknown>
  extends AdapterOperatorPlugin<MongooseOperatorPluginContext<TResult>, unknown> {}

@Injectable()
export class MongooseAdapter
  implements
    QueryAdapter<
      MongooseQueryLike | MongooseAggregateLike,
      MongooseAdapterOptions
    >
{
  ormName = 'mongoose';
  capabilities = {
    supportsRegex: true,
    supportsArrayOperators: true,
    supportsCaseExpressions: false,
    supportsAggregations: true,
    supportsFieldSelection: true,
    supportsIncludes: true,
    supportsPagination: true,
    supportsSorting: true,
  };
  metadata = {
    family: 'mongodb',
    engine: 'mongoose',
  };

  convert<TResult = unknown>(
    normalized: FilterIR,
    options: MongooseAdapterOptions<TResult>,
  ): MongooseQueryLike<TResult> | MongooseAggregateLike<TResult> {
    const aggregation = getAggregationDefinition(normalized);

    if (aggregation) {
      return this.buildAggregateQuery(normalized, aggregation, options);
    }

    const filter = hasComplexLogicalExpression(normalized)
      ? this.buildExpressionFilter(
          getFilterExpression(normalized),
          options.fieldMap,
          options,
        )
      : this.buildFilter(getPredicates(normalized), options.fieldMap, options);
    const projection = this.buildProjection(
      getProjectionFields(normalized),
      options.fieldMap,
    );
    const query = options.model.find(filter, projection);
    const sort = this.buildSort(getSorting(normalized), options.fieldMap);
    const pagination = getPagination(normalized);
    const limit = this.getLimit(pagination.limit, options);
    const offset = this.getOffset(pagination.page, pagination.offset, limit);
    const populate = this.buildPopulate(getRelations(normalized), options.populateMap);

    if (Object.keys(sort).length > 0) {
      query.sort(sort);
    }

    query.limit(limit);
    query.skip(offset);

    if (projection) {
      query.select(projection);
    }

    if (populate.length > 0) {
      query.populate(populate);
    }

    return query;
  }

  private buildAggregateQuery<TResult = unknown>(
    normalized: FilterIR,
    aggregation: AggregateDefinition,
    options: MongooseAdapterOptions<TResult>,
  ): MongooseAggregateLike<TResult> {
    if (!options.model.aggregate) {
      throw new Error('Mongoose model must expose aggregate() for aggregation queries');
    }

    const pipeline = this.buildAggregationPipeline(normalized, aggregation, options);
    return options.model.aggregate(pipeline);
  }

  private buildAggregationPipeline(
    normalized: FilterIR,
    aggregation: AggregateDefinition,
    options: MongooseAdapterOptions,
  ): Record<string, unknown>[] {
    const pipeline: Record<string, unknown>[] = [];
    const filter = hasComplexLogicalExpression(normalized)
      ? this.buildExpressionFilter(
          getFilterExpression(normalized),
          options.fieldMap,
          options,
        )
      : this.buildFilter(getPredicates(normalized), options.fieldMap, options);

    if (Object.keys(filter).length > 0) {
      pipeline.push({ $match: filter });
    }

    const groupStage = this.buildGroupStage(aggregation, options.fieldMap);
    pipeline.push({ $group: groupStage });

    pipeline.push({
      $project: this.buildAggregationProjection(aggregation),
    });

    if (aggregation.having?.length) {
      pipeline.push({
        $match: this.buildFilter(aggregation.having, undefined, options),
      });
    }

    const sort = this.buildSort(getSorting(normalized), options.fieldMap);
    if (Object.keys(sort).length > 0) {
      pipeline.push({ $sort: sort });
    }

    const pagination = getPagination(normalized);
    const limit = this.getLimit(pagination.limit, options);
    const offset = this.getOffset(pagination.page, pagination.offset, limit);

    if (offset > 0) {
      pipeline.push({ $skip: offset });
    }

    pipeline.push({ $limit: limit });

    return pipeline;
  }

  private buildGroupStage(
    aggregation: AggregateDefinition,
    fieldMap?: Record<string, string>,
  ): Record<string, unknown> {
    const groupId =
      aggregation.groupBy?.length
        ? aggregation.groupBy.reduce<Record<string, string>>((accumulator, field) => {
            accumulator[field] = `$${fieldMap?.[field] ?? field}`;
            return accumulator;
          }, {})
        : null;

    return aggregation.metrics.reduce<Record<string, unknown>>(
      (accumulator, metric) => {
        accumulator._id = groupId;
        accumulator[this.getAggregationAlias(metric)] =
          this.buildMongoAccumulator(metric, fieldMap);
        return accumulator;
      },
      { _id: groupId },
    );
  }

  private buildAggregationProjection(
    aggregation: AggregateDefinition,
  ): Record<string, unknown> {
    const projection: Record<string, unknown> = {
      _id: 0,
    };

    for (const groupField of aggregation.groupBy ?? []) {
      projection[groupField] = `$_id.${groupField}`;
    }

    for (const metric of aggregation.metrics) {
      projection[this.getAggregationAlias(metric)] = 1;
    }

    return projection;
  }

  private buildMongoAccumulator(
    metric: AggregationExpression,
    fieldMap?: Record<string, string>,
  ): Record<string, unknown> {
    const field = metric.field ? `$${fieldMap?.[metric.field] ?? metric.field}` : 1;

    switch (metric.operator) {
      case 'count':
        return { $sum: 1 };
      case 'sum':
        return { $sum: field };
      case 'avg':
        return { $avg: field };
      case 'min':
        return { $min: field };
      case 'max':
        return { $max: field };
      default:
        return this.assertNeverAggregationOperator(metric.operator);
    }
  }

  private getAggregationAlias(metric: AggregationExpression): string {
    return metric.alias ?? `${metric.operator}_${metric.field ?? 'all'}`;
  }

  private buildFilter(
    conditions: NormalizedCondition[],
    fieldMap?: Record<string, string>,
    options?: MongooseAdapterOptions,
  ): Record<string, unknown> {
    return conditions.reduce<Record<string, unknown>>((accumulator, condition) => {
      const field = fieldMap?.[condition.field] ?? condition.field;
      const nextValue = this.mapOperator(condition, options);
      const currentValue = accumulator[field];

      if (
        currentValue &&
        typeof currentValue === 'object' &&
        !Array.isArray(currentValue) &&
        typeof nextValue === 'object' &&
        !Array.isArray(nextValue)
      ) {
        accumulator[field] = {
          ...(currentValue as Record<string, unknown>),
          ...(nextValue as Record<string, unknown>),
        };
        return accumulator;
      }

      accumulator[field] = nextValue;
      return accumulator;
    }, {});
  }

  private buildExpressionFilter(
    expression: FilterExpressionNode | undefined,
    fieldMap?: Record<string, string>,
    options?: MongooseAdapterOptions,
  ): Record<string, unknown> {
    if (!expression) {
      return {};
    }

    switch (expression.kind) {
      case 'predicate':
        return this.buildFilter([expression.predicate], fieldMap, options);
      case 'not':
        return {
          $nor: [this.buildExpressionFilter(expression.child, fieldMap, options)],
        };
      case 'group':
        return {
          [expression.operator === 'and' ? '$and' : '$or']: expression.children.map(
            (child) => this.buildExpressionFilter(child, fieldMap, options),
          ),
        };
      default:
        return this.assertNeverExpression(expression);
    }
  }

  private mapOperator(
    condition: NormalizedCondition,
    options?: MongooseAdapterOptions,
  ): unknown {
    switch (condition.operator) {
      case 'eq':
        return condition.value;
      case 'neq':
        return { $ne: condition.value };
      case 'gt':
        return { $gt: condition.value };
      case 'gte':
        return { $gte: condition.value };
      case 'lt':
        return { $lt: condition.value };
      case 'lte':
        return { $lte: condition.value };
      case 'in':
        return { $in: condition.value };
      case 'notIn':
        return { $nin: condition.value };
      case 'all':
        return { $all: condition.value };
      case 'regex':
        return { $regex: condition.value };
      case 'exists':
        return { $exists: condition.value };
      case 'size':
        return { $size: condition.value };
      case 'elemMatch':
        return { $elemMatch: condition.value };
      default:
        return this.resolveCustomOperator(condition, options);
    }
  }

  private resolveCustomOperator(
    condition: NormalizedCondition,
    options?: MongooseAdapterOptions,
  ): unknown {
    const plugin = getDefaultFilterOperatorRegistry().getAdapterOperator<MongooseCustomOperatorPlugin>(
      this.ormName,
      condition.operator,
    );

    if (!plugin) {
      throw new Error(
        `Operator "${condition.operator}" is not supported by MongooseAdapter`,
      );
    }

    return plugin.apply({
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
      options: options ?? ({ model: {} as MongooseModelLike } as MongooseAdapterOptions),
    });
  }

  private buildSort(
    sort: ReturnType<typeof getSorting>,
    fieldMap?: Record<string, string>,
  ): Record<string, 1 | -1> {
    return (sort ?? []).reduce<Record<string, 1 | -1>>((accumulator, item) => {
      const field = fieldMap?.[item.field] ?? item.field;
      accumulator[field] = item.direction === 'asc' ? 1 : -1;
      return accumulator;
    }, {});
  }

  private buildProjection(
    fields: string[] | undefined,
    fieldMap?: Record<string, string>,
  ): string | undefined {
    if (!fields?.length) {
      return undefined;
    }

    return fields.map((field) => fieldMap?.[field] ?? field).join(' ');
  }

  private buildPopulate(
    relationLoad: ReturnType<typeof getRelations>,
    populateMap?: Record<string, MongoosePopulateDefinition | string>,
  ): Array<string | MongoosePopulateDefinition> {
    return normalizeRelationDirectives(relationLoad).map((relation) =>
      this.toPopulateDefinition(relation, populateMap),
    );
  }

  private toPopulateDefinition(
    relation: RelationDefinition,
    populateMap?: Record<string, MongoosePopulateDefinition | string>,
  ): string | MongoosePopulateDefinition {
    this.assertRelationSupport(relation);
    const mapped = relation.path ? populateMap?.[relation.path] : undefined;

    if (typeof mapped === 'string') {
      if (!relation.fields?.length && !relation.nested) {
        return mapped;
      }

      return {
        path: mapped,
        ...(relation.fields?.length
          ? { select: relation.fields.join(' ') }
          : {}),
        ...(relation.nested
          ? {
              populate: normalizeRelationDirectives(relation.nested).map((item) =>
                this.toPopulateDefinitionObject(item, populateMap),
              ),
            }
          : {}),
      };
    }

    if (mapped) {
      return this.mergePopulateDefinitions(mapped, relation, populateMap);
    }

    if (!relation.fields?.length && !relation.nested) {
      return relation.path;
    }

    return this.toPopulateDefinitionObject(relation, populateMap);
  }

  private toPopulateDefinitionObject(
    relation: RelationDefinition,
    populateMap?: Record<string, MongoosePopulateDefinition | string>,
  ): MongoosePopulateDefinition {
    this.assertRelationSupport(relation);
    return {
      path: relation.path,
      ...(relation.fields?.length ? { select: relation.fields.join(' ') } : {}),
      ...(relation.nested
        ? {
            populate: normalizeRelationDirectives(relation.nested).map((item) =>
              this.toPopulateDefinitionObject(item, populateMap),
            ),
          }
        : {}),
    };
  }

  private mergePopulateDefinitions(
    base: MongoosePopulateDefinition,
    relation: RelationDefinition,
    populateMap?: Record<string, MongoosePopulateDefinition | string>,
  ): MongoosePopulateDefinition {
    this.assertRelationSupport(relation);
    return {
      ...base,
      ...(relation.fields?.length ? { select: relation.fields.join(' ') } : {}),
      ...(relation.nested
        ? {
            populate: normalizeRelationDirectives(relation.nested).map((item) =>
              this.toPopulateDefinitionObject(item, populateMap),
            ),
          }
        : {}),
    };
  }

  private getLimit(
    limit: number | undefined,
    options: MongooseAdapterOptions,
  ): number {
    const defaultLimit = options.defaultLimit ?? 100;
    const maxLimit = options.maxLimit ?? 1000;

    return Math.min(limit ?? defaultLimit, maxLimit);
  }

  private assertRelationSupport(relation: RelationDefinition): void {
    if (relation.required) {
      throw new Error(
        'Mongoose adapter does not support required relations with populate(); use aggregation or remove "required".',
      );
    }
  }

  private getOffset(
    page: number | undefined,
    offset: number | undefined,
    limit: number,
  ): number {
    if (offset !== undefined) {
      return Math.max(0, offset);
    }

    if (!page || page <= 0) {
      return 0;
    }

    return (page - 1) * limit;
  }

  private assertNeverExpression(expression: never): never {
    throw new Error(`Unhandled filter expression node: ${JSON.stringify(expression)}`);
  }

  private assertNeverAggregationOperator(operator: never): never {
    throw new Error(`Unhandled aggregation operator: ${String(operator)}`);
  }
}
