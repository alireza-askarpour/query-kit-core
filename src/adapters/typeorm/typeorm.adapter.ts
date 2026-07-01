import { Injectable } from '@nestjs/common';
import {
  NormalizedCaseExpression,
  NormalizedCondition,
  NormalizedFilter,
  QueryAdapter,
} from '../../core';
import { assertSqlOperatorSupport } from '../sql-dialects';
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
      dialect: 'postgres',
    });
  }

  convert<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    normalized: NormalizedFilter,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
  ): TQueryBuilder {
    const queryBuilder = options.queryBuilder;
    const dialect = options.dialect ?? 'postgres';
    const operatorHandlers = createTypeOrmOperatorHandlers({
      escapeLiteral,
      dialect,
    });

    normalized.conditions.forEach((condition) => {
      this.applyCondition(queryBuilder, condition, options, operatorHandlers);
    });

    applyCaseExpressions(queryBuilder, normalized.caseExpressions, (expression, index) =>
      this.buildCaseExpression(expression, index, options, operatorHandlers),
    );
    applyFieldSelection(queryBuilder, normalized.fields, options);
    applyIncludes(
      queryBuilder,
      normalized.relationLoad ?? normalized.customInclude,
      options,
    );
    applySorting(queryBuilder, normalized.sort ?? [], options);
    applyPagination(queryBuilder, normalized, options);

    return queryBuilder;
  }

  private applyCondition<TQueryBuilder extends TypeOrmQueryBuilderLike>(
    queryBuilder: TQueryBuilder,
    condition: NormalizedCondition,
    options: TypeOrmAdapterOptions<TQueryBuilder>,
    operatorHandlers: typeof this.operatorHandlers,
  ): void {
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
}
