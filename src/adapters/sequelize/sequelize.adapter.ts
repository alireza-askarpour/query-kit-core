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

export interface SequelizeAdapterOptions {
  model: ModelStatic<Model>;
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

  private readonly operatorHandlers: Record<string, SequelizeOperatorHandler> =
    {
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
        where[field] = { [Op.iLike]: value };
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
        if (Array.isArray(value)) {
          where[field] = { [Op.overlap]: value };
        }
      },
      all: (field, value, where) => {
        if (Array.isArray(value)) {
          where[field] = { [Op.contains]: value };
        }
      },
      size: (field, value, where) => {
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
        this.appendDateFunction(where, 'YEAR', field, value);
      },
      month: (field, value, where) => {
        this.appendLiteralComparison(
          where,
          `to_char(${this.quoteIdentifier(field)}, 'YYYY-MM')`,
          String(value),
        );
      },
      day: (field, value, where) => {
        this.appendDateFunction(where, 'DAY', field, value);
      },
    };

  convert(
    normalized: NormalizedFilter,
    options: SequelizeAdapterOptions,
  ): SequelizeQueryResult {
    const where: MutableWhere = {};
    const order: OrderItem[] = [];

    for (const condition of normalized.conditions) {
      this.applyCondition(condition, where, options);
    }

    this.applySorting(normalized.sort ?? [], order, options);

    const include = this.normalizeIncludes(
      normalized.relationLoad ?? normalized.customInclude,
      options.includeMap,
    );
    const attributes = this.buildAttributes(normalized, options);
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
  ): void {
    const field = options.fieldMap?.[condition.field] ?? condition.field;
    const resolvedField = condition.field.includes('.') ? `$${field}$` : field;
    const handler = this.operatorHandlers[condition.operator];

    if (!handler) {
      throw new Error(`Unsupported operator "${condition.operator}"`);
    }

    handler(resolvedField, condition.value, where);
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

      return item as Includeable;
    });
  }

  private buildAttributes(
    normalized: NormalizedFilter,
    options: SequelizeAdapterOptions,
  ): FindAttributeOptions | undefined {
    const baseFields = normalized.fields?.length ? [...normalized.fields] : [];
    const caseAttributes = (normalized.caseExpressions ?? []).map((expression) =>
      this.buildCaseAttribute(expression, options),
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
  ): [ReturnType<typeof literal>, string] {
    const sql = expression.cases
      .map(({ when, then }) => {
        const field = options.fieldMap?.[when.field] ?? when.field;
        return `WHEN ${this.buildPredicate(field, when.operator, when.value, options)} THEN ${this.escapeValue(then, options)}`;
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
  ): string {
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
      case 'iLike':
      case 'notLike':
        return `${column} ${operator === 'notLike' ? 'NOT LIKE' : 'LIKE'} ${this.escapeValue(value, options)}`;
      case 'contains':
        return `${column} LIKE ${this.escapeValue(`%${String(value)}%`, options)}`;
      case 'startsWith':
        return `${column} LIKE ${this.escapeValue(`${String(value)}%`, options)}`;
      case 'endsWith':
        return `${column} LIKE ${this.escapeValue(`%${String(value)}`, options)}`;
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
      Sequelize.where(Sequelize.fn(fn, Sequelize.col(field)), value),
    );
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
}
