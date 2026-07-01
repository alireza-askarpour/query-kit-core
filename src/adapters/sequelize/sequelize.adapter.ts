import { Injectable } from '@nestjs/common';
import {
  Attributes,
  col,
  FindAttributeOptions,
  Includeable,
  literal,
  Model,
  ModelStatic,
  Op,
  Order,
  OrderItem,
  Sequelize,
  WhereAttributeHash,
} from 'sequelize';

import {
  NormalizedCaseExpression,
  NormalizedCondition,
  NormalizedFilter,
  NormalizedSort,
  QueryAdapter,
} from '../../core';
import {
  assertSqlOperatorSupport,
  normalizeSequelizeDialect,
  SqlDialect,
} from '../sql-dialects';

export interface SequelizeAdapterOptions {
  model: ModelStatic<Model>;
  dialect?: SqlDialect;
  fieldMap?: Record<string, string>;
  includeMap?: Record<string, Includeable>;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface SequelizeQueryResult {
  where: MutableWhere;
  order: Order;
  limit: number;
  offset: number;
  include?: Includeable[];
  attributes?: FindAttributeOptions;
}

type SequelizeOperatorHandler = (
  field: string,
  value: unknown,
  where: MutableWhere,
) => void;

type MutableWhere = WhereAttributeHash<Attributes<any>> & {
  [Op.and]?: Array<ReturnType<typeof Sequelize.where>>;
};

@Injectable()
export class SequelizeAdapter
  implements QueryAdapter<SequelizeQueryResult, SequelizeAdapterOptions>
{
  ormName = 'sequelize';

  convert(
    normalized: NormalizedFilter,
    options: SequelizeAdapterOptions,
  ): SequelizeQueryResult {
    const dialect = this.resolveDialect(options);
    const where: MutableWhere = {};
    const order: OrderItem[] = [];
    const operatorHandlers = this.createOperatorHandlers(dialect);

    for (const condition of normalized.conditions) {
      this.applyCondition(condition, where, options, operatorHandlers, dialect);
    }

    this.applySorting(normalized.sort ?? [], order, options);

    const include = this.normalizeIncludes(
      normalized.relationLoad ?? normalized.customInclude,
      options.includeMap,
    );
    const attributes = this.buildAttributes(normalized, options, dialect);
    const limit = this.getLimit(normalized.limit, options);

    return {
      where,
      order,
      limit,
      offset: this.getOffset(normalized.page, normalized.offset, limit),
      attributes,
      include: include.length ? include : undefined,
    };
  }

  private applyCondition(
    condition: NormalizedCondition,
    where: MutableWhere,
    options: SequelizeAdapterOptions,
    operatorHandlers: Record<string, SequelizeOperatorHandler>,
    dialect: SqlDialect,
  ): void {
    assertSqlOperatorSupport(
      dialect,
      condition.operator,
      'Sequelize adapter',
    );

    const field = options.fieldMap?.[condition.field] ?? condition.field;
    const resolvedField = condition.field.includes('.') ? `$${field}$` : field;
    const handler = operatorHandlers[condition.operator];

    if (!handler) {
      throw new Error(`Unsupported operator "${condition.operator}"`);
    }

    handler(resolvedField, condition.value, where);
  }

  private createOperatorHandlers(
    dialect: SqlDialect,
  ): Record<string, SequelizeOperatorHandler> {
    return {
      eq: (field, value, where) => {
        where[field] = value;
      },
      neq: (field, value, where) => {
        where[field] = { [Op.ne]: value };
      },
      gt: (field, value, where) => {
        where[field] = { [Op.gt]: value };
      },
      gte: (field, value, where) => {
        where[field] = { [Op.gte]: value };
      },
      lt: (field, value, where) => {
        where[field] = { [Op.lt]: value };
      },
      lte: (field, value, where) => {
        where[field] = { [Op.lte]: value };
      },
      between: (field, value, where) => {
        if (Array.isArray(value) && value.length === 2) {
          where[field] = { [Op.between]: value };
        }
      },
      like: (field, value, where) => {
        where[field] = { [Op.like]: value };
      },
      iLike: (field, value, where) => {
        if (dialect === 'postgres') {
          where[field] = { [Op.iLike]: value };
          return;
        }

        this.appendFunctionPatternComparison(
          where,
          field,
          String(value).toLowerCase(),
        );
      },
      notLike: (field, value, where) => {
        where[field] = { [Op.notLike]: value };
      },
      contains: (field, value, where) => {
        where[field] = { [Op.like]: `%${value}%` };
      },
      startsWith: (field, value, where) => {
        where[field] = { [Op.like]: `${value}%` };
      },
      endsWith: (field, value, where) => {
        where[field] = { [Op.like]: `%${value}` };
      },
      regex: (field, value, where) => {
        assertSqlOperatorSupport(dialect, 'regex', 'Sequelize adapter');
        where[field] = { [Op.regexp]: value };
      },
      in: (field, value, where) => {
        if (Array.isArray(value)) {
          where[field] = { [Op.in]: value };
        }
      },
      notIn: (field, value, where) => {
        if (Array.isArray(value)) {
          where[field] = { [Op.notIn]: value };
        }
      },
      any: (field, value, where) => {
        assertSqlOperatorSupport(dialect, 'any', 'Sequelize adapter');
        if (Array.isArray(value)) {
          where[field] = { [Op.overlap]: value };
        }
      },
      all: (field, value, where) => {
        assertSqlOperatorSupport(dialect, 'all', 'Sequelize adapter');
        if (Array.isArray(value)) {
          where[field] = { [Op.contains]: value };
        }
      },
      size: (field, value, where) => {
        assertSqlOperatorSupport(dialect, 'size', 'Sequelize adapter');
        this.appendLiteralComparison(
          where,
          `cardinality(${this.quoteIdentifier(field)})`,
          value,
        );
      },
      isNull: (field, value, where) => {
        where[field] = { [value ? Op.is : Op.not]: null };
      },
      isNotNull: (field, value, where) => {
        where[field] = { [value ? Op.not : Op.is]: null };
      },
      exists: (field, value, where) => {
        where[field] = { [value ? Op.not : Op.is]: null };
      },
      notExists: (field, value, where) => {
        where[field] = { [value ? Op.is : Op.not]: null };
      },
      date: (field, value, where) => {
        const date = new Date(String(value));
        const nextDay = new Date(date);
        nextDay.setDate(date.getDate() + 1);
        where[field] = { [Op.between]: [date, nextDay] };
      },
      year: (field, value, where) => {
        this.appendYearComparison(where, field, value, dialect);
      },
      month: (field, value, where) => {
        this.appendMonthComparison(where, field, value, dialect);
      },
      day: (field, value, where) => {
        this.appendDayComparison(where, field, value, dialect);
      },
    };
  }

  private applySorting(
    sort: NormalizedSort[],
    order: OrderItem[],
    options: SequelizeAdapterOptions,
  ): void {
    for (const item of sort) {
      const field = options.fieldMap?.[item.field] ?? item.field;

      if (field.includes('.')) {
        order.push([col(field), item.direction.toUpperCase() as 'ASC' | 'DESC']);
        continue;
      }

      order.push([field, item.direction.toUpperCase() as 'ASC' | 'DESC']);
    }
  }

  private normalizeIncludes(
    include?: NormalizedFilter['relationLoad'],
    includeMap?: Record<string, Includeable>,
  ): Includeable[] {
    if (!include) {
      return [];
    }

    const items = Array.isArray(include) ? include : [include];

    return items.map((item) => {
      if (typeof item === 'string') {
        return includeMap?.[item] ?? item;
      }

      return item as unknown as Includeable;
    });
  }

  private buildAttributes(
    normalized: NormalizedFilter,
    options: SequelizeAdapterOptions,
    dialect: SqlDialect,
  ): FindAttributeOptions | undefined {
    const baseFields = normalized.fields?.length ? [...normalized.fields] : [];
    const caseAttributes = (normalized.caseExpressions ?? []).map((expression) =>
      this.buildCaseAttribute(expression, options, dialect),
    );

    if (baseFields.length === 0 && caseAttributes.length === 0) {
      return undefined;
    }

    if (baseFields.length === 0) {
      return { include: caseAttributes };
    }

    return [...baseFields, ...caseAttributes];
  }

  private buildCaseAttribute(
    expression: NormalizedCaseExpression,
    options: SequelizeAdapterOptions,
    dialect: SqlDialect,
  ): [ReturnType<typeof literal>, string] {
    const sql = expression.cases
      .map(({ when, then }) => {
        const field = options.fieldMap?.[when.field] ?? when.field;
        return `WHEN ${this.buildPredicate(field, when.operator, when.value, options, dialect)} THEN ${this.escapeValue(then, options)}`;
      })
      .join(' ');

    const fallback =
      expression.elseValue !== undefined
        ? ` ELSE ${this.escapeValue(expression.elseValue, options)}`
        : '';

    return [literal(`CASE ${sql}${fallback} END`), expression.outputField];
  }

  private buildPredicate(
    field: string,
    operator: NormalizedCondition['operator'],
    value: unknown,
    options: SequelizeAdapterOptions,
    dialect: SqlDialect,
  ): string {
    assertSqlOperatorSupport(
      dialect,
      operator,
      'Sequelize adapter CASE expression',
    );

    const column = this.quoteIdentifier(field);

    switch (operator) {
      case 'eq':
        return `${column} = ${this.escapeValue(value, options)}`;
      case 'neq':
        return `${column} <> ${this.escapeValue(value, options)}`;
      case 'gt':
        return `${column} > ${this.escapeValue(value, options)}`;
      case 'gte':
        return `${column} >= ${this.escapeValue(value, options)}`;
      case 'lt':
        return `${column} < ${this.escapeValue(value, options)}`;
      case 'lte':
        return `${column} <= ${this.escapeValue(value, options)}`;
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          return `${column} BETWEEN ${this.escapeValue(value[0], options)} AND ${this.escapeValue(value[1], options)}`;
        }
        break;
      case 'like':
      case 'notLike':
        return `${column} ${operator === 'notLike' ? 'NOT LIKE' : 'LIKE'} ${this.escapeValue(value, options)}`;
      case 'iLike':
        if (dialect === 'postgres') {
          return `${column} ILIKE ${this.escapeValue(value, options)}`;
        }
        return `LOWER(${column}) LIKE LOWER(${this.escapeValue(value, options)})`;
      case 'contains':
        return `${column} LIKE ${this.escapeValue(`%${String(value)}%`, options)}`;
      case 'startsWith':
        return `${column} LIKE ${this.escapeValue(`${String(value)}%`, options)}`;
      case 'endsWith':
        return `${column} LIKE ${this.escapeValue(`%${String(value)}`, options)}`;
      case 'regex':
        if (dialect === 'postgres') {
          return `${column} ~ ${this.escapeValue(value, options)}`;
        }
        if (dialect === 'mysql') {
          return `${column} REGEXP ${this.escapeValue(value, options)}`;
        }
        break;
      case 'in':
      case 'notIn':
        if (Array.isArray(value) && value.length > 0) {
          const values = value.map((item) => this.escapeValue(item, options)).join(', ');
          return `${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${values})`;
        }
        break;
      case 'isNull':
        return `${column} ${value ? 'IS NULL' : 'IS NOT NULL'}`;
      case 'isNotNull':
        return `${column} ${value ? 'IS NOT NULL' : 'IS NULL'}`;
      case 'exists':
        return `${column} ${value ? 'IS NOT NULL' : 'IS NULL'}`;
      case 'notExists':
        return `${column} ${value ? 'IS NULL' : 'IS NOT NULL'}`;
      default:
        break;
    }

    throw new Error(`Unsupported CASE operator "${operator}"`);
  }

  private getLimit(
    limit: number | undefined,
    options: SequelizeAdapterOptions,
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

  private appendDateFunction(
    where: MutableWhere,
    fn: 'YEAR' | 'DAY',
    field: string,
    value: unknown,
  ): void {
    const andConditions = this.ensureAndConditions(where);
    andConditions.push(
      Sequelize.where(
        Sequelize.fn(fn, Sequelize.col(this.normalizeColumnReference(field))),
        value,
      ),
    );
  }

  private appendFunctionPatternComparison(
    where: MutableWhere,
    field: string,
    value: unknown,
  ): void {
    const andConditions = this.ensureAndConditions(where);
    andConditions.push(
      Sequelize.where(
        Sequelize.fn('LOWER', Sequelize.col(this.normalizeColumnReference(field))),
        { [Op.like]: value },
      ),
    );
  }

  private appendYearComparison(
    where: MutableWhere,
    field: string,
    value: unknown,
    dialect: SqlDialect,
  ): void {
    switch (dialect) {
      case 'postgres':
        this.appendLiteralComparison(
          where,
          `EXTRACT(YEAR FROM ${this.quoteIdentifier(field)})`,
          value,
        );
        return;
      case 'mysql':
        this.appendDateFunction(where, 'YEAR', field, value);
        return;
      case 'sqlite':
        this.appendLiteralComparison(
          where,
          `CAST(strftime('%Y', ${this.quoteIdentifier(field)}) AS INTEGER)`,
          value,
        );
        return;
      default:
        return this.assertNeverDialect(dialect);
    }
  }

  private appendMonthComparison(
    where: MutableWhere,
    field: string,
    value: unknown,
    dialect: SqlDialect,
  ): void {
    switch (dialect) {
      case 'postgres':
        this.appendLiteralComparison(
          where,
          `TO_CHAR(${this.quoteIdentifier(field)}, 'YYYY-MM')`,
          String(value),
        );
        return;
      case 'mysql':
        this.appendLiteralComparison(
          where,
          `DATE_FORMAT(${this.quoteIdentifier(field)}, '%Y-%m')`,
          String(value),
        );
        return;
      case 'sqlite':
        this.appendLiteralComparison(
          where,
          `strftime('%Y-%m', ${this.quoteIdentifier(field)})`,
          String(value),
        );
        return;
      default:
        return this.assertNeverDialect(dialect);
    }
  }

  private appendDayComparison(
    where: MutableWhere,
    field: string,
    value: unknown,
    dialect: SqlDialect,
  ): void {
    switch (dialect) {
      case 'postgres':
        this.appendLiteralComparison(
          where,
          `EXTRACT(DAY FROM ${this.quoteIdentifier(field)})`,
          value,
        );
        return;
      case 'mysql':
        this.appendDateFunction(where, 'DAY', field, value);
        return;
      case 'sqlite':
        this.appendLiteralComparison(
          where,
          `CAST(strftime('%d', ${this.quoteIdentifier(field)}) AS INTEGER)`,
          value,
        );
        return;
      default:
        return this.assertNeverDialect(dialect);
    }
  }

  private appendLiteralComparison(
    where: MutableWhere,
    expression: string,
    value: unknown,
  ): void {
    const andConditions = this.ensureAndConditions(where);
    andConditions.push(Sequelize.where(literal(expression), value as any));
  }

  private quoteIdentifier(field: string): string {
    if (field.startsWith('$') && field.endsWith('$')) {
      field = field.slice(1, -1);
    }

    return field
      .split('.')
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join('.');
  }

  private normalizeColumnReference(field: string): string {
    if (field.startsWith('$') && field.endsWith('$')) {
      return field.slice(1, -1);
    }

    return field;
  }

  private escapeValue(value: unknown, options: SequelizeAdapterOptions): string {
    const sequelize = options.model?.sequelize;

    if (sequelize) {
      const escapableValue = this.toEscapableValue(value);
      if (escapableValue === null) {
        return 'NULL';
      }
      if (typeof escapableValue === 'boolean') {
        return escapableValue ? 'true' : 'false';
      }
      return sequelize.escape(escapableValue);
    }

    if (value === null) {
      return 'NULL';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private ensureAndConditions(
    where: MutableWhere,
  ): Array<ReturnType<typeof Sequelize.where>> {
    let andConditions = where[Op.and];

    if (!andConditions) {
      andConditions = [];
      where[Op.and] = andConditions;
    }

    return andConditions;
  }

  private toEscapableValue(value: unknown): string | number | boolean | Date | null {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date
    ) {
      return value;
    }

    return String(value);
  }

  private resolveDialect(options: SequelizeAdapterOptions): SqlDialect {
    if (options.dialect) {
      return options.dialect;
    }

    const rawDialect = options.model?.sequelize?.getDialect?.();
    if (!rawDialect) {
      throw new Error(
        'Sequelize adapter requires an explicit SQL dialect or a model with sequelize.getDialect()',
      );
    }

    return normalizeSequelizeDialect(rawDialect);
  }

  private assertNeverDialect(dialect: never): never {
    throw new Error(`Unhandled SQL dialect "${dialect}"`);
  }
}
