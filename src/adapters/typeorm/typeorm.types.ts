import {
  AdapterOperatorPlugin,
  BuiltinFilterOperator,
  RelationDefinition,
} from '../../core';
import { SqlDialect } from '../sql-dialects';

export interface TypeOrmQueryBuilderLike {
  andWhere(condition: string, parameters?: Record<string, unknown>): this;
  addOrderBy(sort: string, order?: 'ASC' | 'DESC'): this;
  take(limit: number): this;
  skip(offset: number): this;
  select(selection: string[]): this;
  addSelect(selection: string, aliasName?: string): this;
  groupBy?(group: string): this;
  addGroupBy?(group: string): this;
  having?(condition: string, parameters?: Record<string, unknown>): this;
  andHaving?(condition: string, parameters?: Record<string, unknown>): this;
  leftJoin(path: string, alias: string): this;
  leftJoinAndSelect(path: string, alias: string): this;
  innerJoin?(path: string, alias: string): this;
  innerJoinAndSelect?(path: string, alias: string): this;
}

export interface TypeOrmJoinDefinition extends RelationDefinition {
  alias?: string;
  select?: boolean;
}

export interface TypeOrmAdapterOptions<
  TQueryBuilder extends TypeOrmQueryBuilderLike = TypeOrmQueryBuilderLike,
> {
  queryBuilder: TQueryBuilder;
  dialect?: SqlDialect;
  rootAlias?: string;
  fieldMap?: Record<string, string>;
  includeMap?: Record<string, TypeOrmJoinDefinition>;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface TypeOrmWhereClause {
  condition: string;
  parameters?: Record<string, unknown>;
}

export type TypeOrmOperatorHandler = (
  field: string,
  value: unknown,
  parameterName: string,
) => TypeOrmWhereClause;

export interface TypeOrmOperatorPluginContext<
  TQueryBuilder extends TypeOrmQueryBuilderLike = TypeOrmQueryBuilderLike,
> {
  field: string;
  operator: string;
  value: unknown;
  parameterName: string;
  options: TypeOrmAdapterOptions<TQueryBuilder>;
  dialect: SqlDialect;
  escapeLiteral(value: unknown): string;
}

export interface TypeOrmCustomOperatorPlugin<
  TQueryBuilder extends TypeOrmQueryBuilderLike = TypeOrmQueryBuilderLike,
> extends AdapterOperatorPlugin<
    TypeOrmOperatorPluginContext<TQueryBuilder>,
    TypeOrmWhereClause
  > {}

export interface TypeOrmClauseBuilderDependencies {
  escapeLiteral(value: unknown): string;
  dialect: SqlDialect;
}

export type SupportedTypeOrmOperator = BuiltinFilterOperator;
