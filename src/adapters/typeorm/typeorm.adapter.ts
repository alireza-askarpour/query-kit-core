import { Injectable } from '@nestjs/common';
import {
  AggregationExpression,
  FilterIR,
  FilterExpressionNode,
  FilterPredicate,
  getAggregationDefinition,
  getFilterExpression,
  getProjectionFields,
  getPredicates,
  getRelations,
  getSorting,
  hasComplexLogicalExpression,
  getSqlFilterFeatures,
  NormalizedCaseExpression,
  NormalizedCondition,
  QueryAdapter,
} from '../../core';
import { assertSqlOperatorSupport } from '../sql-dialects';
import {
  applyAggregations,
  applyCaseExpressions,
  applyFieldSelection,
  applyIncludes,
  applyPagination,
  applySorting,
  createCaseParameterName,
  createParameterName,
  escapeLiteral,
  inlineCondition,
  resolveField,
} from './typeorm.utils';
import {
  TypeOrmAdapterOptions,
  TypeOrmOperatorHandler,
  TypeOrmQueryBuilderLike,
} from './typeorm.types';
import {
  buildWhereClause,
  createTypeOrmOperatorHandlers,
} from './typeorm-where.builder';

@Injectable()
export class TypeOrmAdapter
  implements QueryAdapter<TypeOrmQueryBuilderLike, TypeOrmAdapterOptions>
{
  ormName = 'typeorm';
  capabilities = {
    supportsRegex: true,
    supportsArrayOperators: true,
    supportsCaseExpressions: true,
    supportsAggregations: true,
    supportsFieldSelection: true,
    supportsIncludes: true,
    supportsPagination: true,
    supportsSorting: true,
  };
  metadata = {
    family: 'sql',
    engine: 'typeorm',
  };
  private readonly operatorHandlers: Record<
    NormalizedCondition['operator'],
    TypeOrmOperatorHandler
  >;

  constructor() {
    this.operatorHandlers = createTypeOrmOperatorHandlers({
      escapeLiteral,
      dialect: 'postgres',
    });
  }

  convert<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    normalized: FilterIR,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): TQueryBuilder {
    const queryBuilder = options.queryBuilder;
    const dialect = options.dialect ?? 'postgres';
    const operatorHandlers = createTypeOrmOperatorHandlers({
      escapeLiteral,
      dialect,
    });

    if (hasComplexLogicalExpression(normalized)) {
      const expression = getFilterExpression(normalized);

      if (expression) {
        const clause = this.buildExpressionClause(
          expression,
          options,
          operatorHandlers,
        );
        queryBuilder.andWhere(clause.condition, clause.parameters);
      }
    } else {
      getPredicates(normalized).forEach((condition) => {
        this.applyCondition(queryBuilder, condition, options, operatorHandlers);
      });
    }

    const sqlFeatures = getSqlFilterFeatures(normalized);
    const aggregation = getAggregationDefinition(normalized);
    applyAggregations(
      queryBuilder,
      aggregation,
      options,
      (metric) => this.buildAggregationExpression(metric, options),
      (predicate) =>
        this.buildHavingExpression(predicate, aggregation, options, operatorHandlers),
    );
    applyCaseExpressions(queryBuilder, sqlFeatures.caseExpressions, (expression, index) =>
      this.buildCaseExpression(expression, index, options, operatorHandlers),
    );
    if (!aggregation) {
      applyFieldSelection(queryBuilder, getProjectionFields(normalized), options);
    }
    applyIncludes(
      queryBuilder,
      getRelations(normalized),
      options,
    );
    applySorting(queryBuilder, getSorting(normalized), options);
    applyPagination(queryBuilder, normalized, options);

    return queryBuilder;
  }

  private applyCondition<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    queryBuilder: TQueryBuilder,
    condition: NormalizedCondition,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
    operatorHandlers: typeof this.operatorHandlers,
  ): void {
    const handler = operatorHandlers[condition.operator];

    if (!handler) {
      throw new Error(
        `Operator "${condition.operator}" not supported in TypeORM adapter`,
      );
    }

    assertSqlOperatorSupport(
      options.dialect ?? 'postgres',
      condition.operator,
      'TypeORM adapter',
    );
    const field = resolveField(condition.field, options);
    const parameterName = createParameterName(condition.field, condition.operator);
    const whereClause = buildWhereClause(
      operatorHandlers,
      field,
      condition.operator,
      condition.value,
      parameterName,
    );

    queryBuilder.andWhere(whereClause.condition, whereClause.parameters);
  }

  private buildExpressionClause<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    expression: FilterExpressionNode,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
    operatorHandlers: typeof this.operatorHandlers,
    scope: number[] = [],
  ): { condition: string; parameters?: Record<string, unknown> } {
    switch (expression.kind) {
      case 'predicate': {
        const handler = operatorHandlers[expression.predicate.operator];

        if (!handler) {
          throw new Error(
            `Operator "${expression.predicate.operator}" not supported in TypeORM adapter`,
          );
        }

        assertSqlOperatorSupport(
          options.dialect ?? 'postgres',
          expression.predicate.operator,
          'TypeORM adapter',
        );
        const field = resolveField(expression.predicate.field, options);
        const parameterName = `${createParameterName(
          expression.predicate.field,
          expression.predicate.operator,
        )}_${scope.join('_') || 'root'}`;

        return buildWhereClause(
          operatorHandlers,
          field,
          expression.predicate.operator,
          expression.predicate.value,
          parameterName,
        );
      }
      case 'not': {
        const childClause = this.buildExpressionClause(
          expression.child,
          options,
          operatorHandlers,
          [...scope, 0],
        );

        return {
          condition: `NOT (${childClause.condition})`,
          parameters: childClause.parameters,
        };
      }
      case 'group': {
        const clauses = expression.children.map((child, index) =>
          this.buildExpressionClause(
            child,
            options,
            operatorHandlers,
            [...scope, index],
          ),
        );

        return {
          condition: clauses
            .map((clause) => `(${clause.condition})`)
            .join(expression.operator === 'and' ? ' AND ' : ' OR '),
          parameters: clauses.reduce<Record<string, unknown>>((accumulator, clause) => {
            if (!clause.parameters) {
              return accumulator;
            }

            return { ...accumulator, ...clause.parameters };
          }, {}),
        };
      }
      default:
        return this.assertNeverExpression(expression);
    }
  }

  private buildCaseExpression<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    expression: NormalizedCaseExpression,
    expressionIndex: number,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
    operatorHandlers: typeof this.operatorHandlers,
  ): string {
    const clauses = expression.cases
      .map((entry, caseIndex) => {
        assertSqlOperatorSupport(
          options.dialect ?? 'postgres',
          entry.when.operator,
          'TypeORM adapter CASE expression',
        );
        const field = resolveField(entry.when.field, options);
        const parameterName = createCaseParameterName(
          expression.outputField,
          expressionIndex,
          caseIndex,
        );
        const predicate = buildWhereClause(
          operatorHandlers,
          field,
          entry.when.operator,
          entry.when.value,
          parameterName,
        );

        return `WHEN ${inlineCondition(predicate, escapeLiteral)} THEN ${escapeLiteral(entry.then)}`;
      })
      .join(' ');

    const elseClause =
      expression.elseValue !== undefined
        ? ` ELSE ${escapeLiteral(expression.elseValue)}`
        : '';

    return `${clauses}${elseClause}`;
  }

  private buildAggregationExpression<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    metric: AggregationExpression,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): string {
    const field = metric.field ? resolveField(metric.field, options) : undefined;

    switch (metric.operator) {
      case 'count':
        return field ? `COUNT(${field})` : 'COUNT(*)';
      case 'sum':
        return `SUM(${this.requireAggregationField(field, metric.operator)})`;
      case 'avg':
        return `AVG(${this.requireAggregationField(field, metric.operator)})`;
      case 'min':
        return `MIN(${this.requireAggregationField(field, metric.operator)})`;
      case 'max':
        return `MAX(${this.requireAggregationField(field, metric.operator)})`;
      default:
        return this.assertNeverAggregationOperator(metric.operator);
    }
  }

  private buildHavingExpression<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    predicate: FilterPredicate,
    aggregation: ReturnType<typeof getAggregationDefinition>,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
    operatorHandlers: typeof this.operatorHandlers,
  ): string {
    const field = this.resolveHavingFieldExpression(
      predicate.field,
      aggregation,
      options,
    );
    const clause = buildWhereClause(
      operatorHandlers,
      field,
      predicate.operator,
      predicate.value,
      createParameterName(predicate.field, predicate.operator),
    );

    return inlineCondition(clause, escapeLiteral);
  }

  private resolveHavingFieldExpression<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    field: string,
    aggregation: ReturnType<typeof getAggregationDefinition>,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): string {
    const metric = aggregation?.metrics.find(
      (item) => (item.alias ?? `${item.operator}_${item.field ?? 'all'}`) === field,
    );

    if (metric) {
      return this.buildAggregationExpression(metric, options);
    }

    return resolveField(field, options);
  }

  private requireAggregationField(
    field: string | undefined,
    operator: AggregationExpression['operator'],
  ): string {
    if (!field) {
      throw new Error(`Aggregation operator "${operator}" requires a field`);
    }

    return field;
  }

  private assertNeverExpression(expression: never): never {
    throw new Error(`Unhandled filter expression node: ${JSON.stringify(expression)}`);
  }

  private assertNeverAggregationOperator(operator: never): never {
    throw new Error(`Unhandled aggregation operator: ${String(operator)}`);
  }
}
