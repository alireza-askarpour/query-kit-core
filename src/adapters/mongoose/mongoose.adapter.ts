import { Injectable } from '@nestjs/common';
import {
  FilterIR,
  FilterExpressionNode,
  getFilterExpression,
  getPagination,
  getPredicates,
  getProjectionFields,
  getRelations,
  getSorting,
  hasComplexLogicalExpression,
  NormalizedCondition,
  QueryAdapter,
} from '../../core';

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

export interface MongooseAdapterOptions<TResult = unknown> {
  model: MongooseModelLike<TResult>;
  fieldMap?: Record<string, string>;
  populateMap?: Record<string, MongoosePopulateDefinition | string>;
  defaultLimit?: number;
  maxLimit?: number;
}

@Injectable()
export class MongooseAdapter
  implements QueryAdapter<MongooseQueryLike, MongooseAdapterOptions>
{
  ormName = 'mongoose';

  convert<TResult = unknown>(
    normalized: FilterIR,
    options: MongooseAdapterOptions<TResult>,
  ): MongooseQueryLike<TResult> {
    const filter = hasComplexLogicalExpression(normalized)
      ? this.buildExpressionFilter(
          getFilterExpression(normalized),
          options.fieldMap,
        )
      : this.buildFilter(getPredicates(normalized), options.fieldMap);
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

  private buildFilter(
    conditions: NormalizedCondition[],
    fieldMap?: Record<string, string>,
  ): Record<string, unknown> {
    return conditions.reduce<Record<string, unknown>>((accumulator, condition) => {
      const field = fieldMap?.[condition.field] ?? condition.field;
      const nextValue = this.mapOperator(condition);
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
  ): Record<string, unknown> {
    if (!expression) {
      return {};
    }

    switch (expression.kind) {
      case 'predicate':
        return this.buildFilter([expression.predicate], fieldMap);
      case 'not':
        return {
          $nor: [this.buildExpressionFilter(expression.child, fieldMap)],
        };
      case 'group':
        return {
          [expression.operator === 'and' ? '$and' : '$or']: expression.children.map(
            (child) => this.buildExpressionFilter(child, fieldMap),
          ),
        };
      default:
        return this.assertNeverExpression(expression);
    }
  }

  private mapOperator(condition: NormalizedCondition): unknown {
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
        throw new Error(
          `Operator "${condition.operator}" is not supported by MongooseAdapter`,
        );
    }
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
    if (!relationLoad) {
      return [];
    }

    const items = Array.isArray(relationLoad) ? relationLoad : [relationLoad];

    return items.map((item) => {
      if (typeof item !== 'string') {
        if (this.isPopulateDefinition(item)) {
          return item;
        }

        throw new Error(
          'Invalid populate definition. Object-based relationLoad entries must include a "path" field.',
        );
      }

      return populateMap?.[item] ?? item;
    });
  }

  private isPopulateDefinition(
    value: unknown,
  ): value is MongoosePopulateDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      'path' in value &&
      typeof value.path === 'string' &&
      value.path.length > 0
    );
  }

  private getLimit(
    limit: number | undefined,
    options: MongooseAdapterOptions,
  ): number {
    const defaultLimit = options.defaultLimit ?? 100;
    const maxLimit = options.maxLimit ?? 1000;

    return Math.min(limit ?? defaultLimit, maxLimit);
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
}
