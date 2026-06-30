import { Injectable } from '@nestjs/common';
import {
  NormalizedCaseExpression,
  NormalizedCondition,
  NormalizedFilter,
  QueryAdapter,
} from '../../core';
import {
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
  private readonly operatorHandlers: Record<
    NormalizedCondition['operator'],
    TypeOrmOperatorHandler
  >;

  constructor() {
    this.operatorHandlers = createTypeOrmOperatorHandlers({
      escapeLiteral,
    });
  }

  convert<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    normalized: NormalizedFilter,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): TQueryBuilder {
    const queryBuilder = options.queryBuilder;

    normalized.conditions.forEach((condition) => {
      this.applyCondition(queryBuilder, condition, options);
    });

    applyCaseExpressions(queryBuilder, normalized.caseExpressions, (expression, index) =>
      this.buildCaseExpression(expression, index, options),
    );
    applyFieldSelection(queryBuilder, normalized.fields, options);
    applyIncludes(queryBuilder, normalized.customInclude, options);
    applySorting(queryBuilder, normalized.sort ?? [], options);
    applyPagination(queryBuilder, normalized, options);

    return queryBuilder;
  }

  private applyCondition<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    queryBuilder: TQueryBuilder,
    condition: NormalizedCondition,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): void {
    const field = resolveField(condition.field, options);
    const parameterName = createParameterName(condition.field, condition.operator);
    const whereClause = buildWhereClause(
      this.operatorHandlers,
      field,
      condition.operator,
      condition.value,
      parameterName,
    );

    queryBuilder.andWhere(whereClause.condition, whereClause.parameters);
  }

  private buildCaseExpression<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    expression: NormalizedCaseExpression,
    expressionIndex: number,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): string {
    const clauses = expression.cases
      .map((entry, caseIndex) => {
        const field = resolveField(entry.when.field, options);
        const parameterName = createCaseParameterName(
          expression.outputField,
          expressionIndex,
          caseIndex,
        );
        const predicate = buildWhereClause(
          this.operatorHandlers,
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
}
