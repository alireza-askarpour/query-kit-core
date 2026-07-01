import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createLogicalGroupNode,
  createNotNode,
  createPredicateNode,
  createFilterIR,
  FilterFormat,
  FilterExpressionNode,
  FilterOperator,
  getPredicates,
  NormalizedCaseExpression,
  NormalizedCondition,
  NormalizedSort,
  Query,
} from '../../core';
import {
  parseRawLogicalExpression,
  RawExpressionNode,
  splitTopLevelSegments,
} from './sc-logical-expression.parser';

@Injectable()
export class SCFormat implements FilterFormat {
  name = 'scfilter';

  private readonly operatorAliases: Record<string, FilterOperator> = {
    eq: 'eq',
    neq: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    between: 'between',
    like: 'like',
    ilike: 'iLike',
    notlike: 'notLike',
    contains: 'contains',
    startswith: 'startsWith',
    endswith: 'endsWith',
    regex: 'regex',
    in: 'in',
    notin: 'notIn',
    any: 'any',
    all: 'all',
    size: 'size',
    isnull: 'isNull',
    isnotnull: 'isNotNull',
    exists: 'exists',
    notexists: 'notExists',
    date: 'date',
    year: 'year',
    month: 'month',
    day: 'day',
  };

  private readonly validOperators = new Set<FilterOperator>([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'like',
    'iLike',
    'notLike',
    'contains',
    'startsWith',
    'endsWith',
    'regex',
    'in',
    'notIn',
    'any',
    'all',
    'size',
    'isNull',
    'isNotNull',
    'exists',
    'notExists',
    'date',
    'year',
    'month',
    'day',
  ]);

  private readonly arrayOperators: FilterOperator[] = [
    'in',
    'notIn',
    'any',
    'all',
  ];

  private readonly numericOperators: FilterOperator[] = [
    'gt',
    'gte',
    'lt',
    'lte',
    'size',
  ];

  private readonly booleanOperators: FilterOperator[] = [
    'isNull',
    'isNotNull',
    'exists',
    'notExists',
  ];

  private readonly dateOperators: FilterOperator[] = [
    'date',
    'year',
    'month',
    'day',
  ];

  public parse(query: Query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return createFilterIR({
        predicates: [],
        sorting: this.parseSort(query.sortString),
        pagination: {
          limit: query.size,
          page: query.page,
          offset: query.offset,
        },
        projection: query.fields ? { fields: query.fields } : undefined,
        relations: query.relations ?? query.customInclude,
        customInclude: query.customInclude,
        extensions: {
          sql: {
            caseExpressions: [],
          },
        },
      });
    }

    const segments = this.splitSegments(filterString);
    const conditions: NormalizedCondition[] = [];
    const caseExpressions: NormalizedCaseExpression[] = [];
    const expressionSegments: string[] = [];
    const directives = {
      sort: [] as NormalizedSort[],
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      include: query.customInclude,
    };

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];

      if (this.isDirective(segment)) {
        this.applyDirective(segment, directives);
        continue;
      }

      if (segment.startsWith('case:')) {
        const { expression, nextIndex } = this.parseCaseExpression(
          segments,
          index,
        );
        caseExpressions.push(expression);
        index = nextIndex;
        continue;
      }

      expressionSegments.push(segment);
    }

    const expressionInput = expressionSegments.join(';');

    if (this.containsLogicalSyntax(expressionInput)) {
      const expression = this.parseLogicalExpression(expressionInput);
      conditions.push(...getPredicates({ predicates: [], expression }));

      return createFilterIR({
        predicates: conditions,
        expression,
        sorting: directives.sort.length
          ? directives.sort
          : this.parseSort(query.sortString),
        pagination: {
          limit: directives.limit,
          page: directives.page,
          offset: directives.offset,
        },
        projection: directives.fields ? { fields: directives.fields } : undefined,
        relations: directives.relationLoad,
        customInclude: directives.include,
        extensions: {
          sql: {
            caseExpressions,
          },
        },
      });
    }

    for (const segment of expressionSegments) {
      const condition = this.parseCondition(segment);
      this.validateCondition(condition);
      conditions.push(condition);
    }

    return createFilterIR({
      predicates: conditions,
      sorting: directives.sort.length
        ? directives.sort
        : this.parseSort(query.sortString),
      pagination: {
        limit: directives.limit,
        page: directives.page,
        offset: directives.offset,
      },
      projection: directives.fields ? { fields: directives.fields } : undefined,
      relations: directives.relationLoad,
      customInclude: directives.include,
      extensions: {
        sql: {
          caseExpressions,
        },
      },
    });
  }

  private splitSegments(queryString: string): string[] {
    return splitTopLevelSegments(queryString)
      .map((segment) => segment.replace(/\\;/g, ';').trim())
      .filter(Boolean);
  }

  private containsLogicalSyntax(value: string): boolean {
    let escaped = false;

    for (const character of value) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '|' || character === '!' || character === '(' || character === ')') {
        return true;
      }
    }

    return false;
  }

  private parseLogicalExpression(input: string): FilterExpressionNode {
    try {
      const rawExpression = parseRawLogicalExpression(input);

      if (!rawExpression) {
        throw new BadRequestException('Logical expression cannot be empty');
      }

      return this.mapRawExpression(rawExpression);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid logical expression',
      );
    }
  }

  private mapRawExpression(rawExpression: RawExpressionNode): FilterExpressionNode {
    switch (rawExpression.kind) {
      case 'predicate': {
        const condition = this.parseCondition(rawExpression.raw);
        this.validateCondition(condition);
        return createPredicateNode(condition);
      }
      case 'not':
        return createNotNode(this.mapRawExpression(rawExpression.child));
      case 'group':
        return createLogicalGroupNode(
          rawExpression.operator,
          rawExpression.children.map((child) => this.mapRawExpression(child)),
        );
      default:
        return this.assertNeverRawExpression(rawExpression);
    }
  }

  private isDirective(segment: string): boolean {
    return segment.startsWith('@');
  }

  private applyDirective(
    segment: string,
    directives: {
      sort: NormalizedSort[];
      limit?: number;
      page?: number;
      offset?: number;
      fields?: string[];
      relationLoad?: Query['relations'];
      include?: Query['customInclude'];
    },
  ): void {
    const [directiveName, rawValue = ''] = this.splitByUnescapedColon(segment);
    const name = directiveName.slice(1).trim().toLowerCase();
    const value = rawValue.trim();

    switch (name) {
      case 'sort':
        directives.sort = this.parseSortDirective(value);
        break;
      case 'limit':
        directives.limit = this.parsePositiveInteger(value, '@limit');
        break;
      case 'page':
        directives.page = this.parsePositiveInteger(value, '@page');
        break;
      case 'offset':
        directives.offset = this.parseNonNegativeInteger(value, '@offset');
        break;
      case 'fields':
        directives.fields = this.parseCommaSeparatedList(value, '@fields');
        break;
      case 'include':
        directives.relationLoad = this.parseCommaSeparatedList(value, '@include');
        directives.include = this.parseCommaSeparatedList(value, '@include');
        break;
      default:
        throw new BadRequestException(`Unsupported directive "${directiveName}"`);
    }
  }

  private parseSortDirective(value: string): NormalizedSort[] {
    const items = this.parseCommaSeparatedList(value, '@sort');

    return items.map((item) => {
      const direction = item.startsWith('-') ? 'desc' : 'asc';
      const field = item.replace(/^[-+]/, '').trim();

      if (!field) {
        throw new BadRequestException('Sort field cannot be empty');
      }

      return { field, direction };
    });
  }

  private parseCondition(condition: string): NormalizedCondition {
    const [field, rawOperator, ...rawValue] = this.splitByUnescapedColon(
      condition,
    );

    if (!field || !rawOperator || rawValue.length === 0) {
      throw new BadRequestException(
        `Invalid condition format: "${condition}". Expected field:operator:value`,
      );
    }

    const operator = this.normalizeOperator(rawOperator.trim());
    const value = this.parseValue(rawValue.join(':').trim(), operator);

    return {
      field: this.unescapeSegment(field.trim()),
      operator,
      value,
    };
  }

  private parseCaseExpression(
    segments: string[],
    startIndex: number,
  ): { expression: NormalizedCaseExpression; nextIndex: number } {
    const tokens = this.splitByUnescapedColon(segments[startIndex]);

    if (tokens.length < 2) {
      throw new BadRequestException(
        'CASE expression requires an output field: case:outputField',
      );
    }

    const outputField = this.unescapeSegment(tokens[1].trim());
    const cases: NormalizedCaseExpression['cases'] = [];
    let elseValue: unknown;
    let index = startIndex;

    const inlineTokens = tokens.slice(2);
    if (inlineTokens.length > 0) {
      const inlineSegment = inlineTokens.join(':');
      if (inlineSegment.startsWith('when:')) {
        const parsed = this.parseCaseWhenSegment(inlineSegment);
        cases.push(parsed);
      } else if (inlineSegment.startsWith('else:')) {
        elseValue = this.parsePrimitive(inlineSegment.slice(5).trim());
      } else {
        throw new BadRequestException(
          `Invalid CASE segment "${segments[startIndex]}"`,
        );
      }
    }

    while (index + 1 < segments.length) {
      const nextSegment = segments[index + 1];

      if (nextSegment.startsWith('when:')) {
        cases.push(this.parseCaseWhenSegment(nextSegment));
        index += 1;
        continue;
      }

      if (nextSegment.startsWith('else:')) {
        elseValue = this.parsePrimitive(nextSegment.slice(5).trim());
        index += 1;
      }

      break;
    }

    if (cases.length === 0) {
      throw new BadRequestException(
        `CASE expression "${outputField}" must contain at least one when/then pair`,
      );
    }

    return {
      expression: {
        outputField,
        cases,
        elseValue,
      },
      nextIndex: index,
    };
  }

  private parseCaseWhenSegment(segment: string) {
    const tokens = this.splitByUnescapedColon(segment);

    if (tokens.length < 6 || tokens[0] !== 'when') {
      throw new BadRequestException(
        `Invalid CASE condition "${segment}". Expected when:field:operator:value:then:result`,
      );
    }

    const thenIndex = tokens.findIndex((token) => token === 'then');
    if (thenIndex < 4 || thenIndex === tokens.length - 1) {
      throw new BadRequestException(
        `Invalid CASE condition "${segment}". Missing then:value segment`,
      );
    }

    const field = this.unescapeSegment(tokens[1].trim());
    const operator = this.normalizeOperator(tokens[2].trim());
    const rawValue = tokens.slice(3, thenIndex).join(':').trim();
    const thenValue = tokens.slice(thenIndex + 1).join(':').trim();
    const when: NormalizedCondition = {
      field,
      operator,
      value: this.parseValue(rawValue, operator),
    };

    this.validateCondition(when);

    return {
      when,
      then: this.parsePrimitive(thenValue),
    };
  }

  private parseValue(rawValue: string, operator: FilterOperator): unknown {
    const value = this.unescapeSegment(rawValue.trim());

    if (this.arrayOperators.includes(operator)) {
      return this.parseCommaSeparatedList(value, operator).map((item) =>
        this.parsePrimitive(item),
      );
    }

    if (operator === 'between') {
      const values = this.parseCommaSeparatedList(value, operator);

      if (values.length !== 2) {
        throw new BadRequestException(
          'Between operator requires two comma-separated values',
        );
      }

      return values.map((item) => this.parsePrimitive(item));
    }

    if (this.numericOperators.includes(operator)) {
      const parsed = Number(value);

      if (Number.isNaN(parsed)) {
        throw new BadRequestException(
          `Operator "${operator}" requires a numeric value`,
        );
      }

      return parsed;
    }

    if (this.booleanOperators.includes(operator)) {
      return this.parseBoolean(value, operator);
    }

    if (operator === 'year') {
      if (!/^\d{4}$/.test(value)) {
        throw new BadRequestException('Year operator requires YYYY format');
      }
      return Number(value);
    }

    if (operator === 'day') {
      const day = Number(value);

      if (!Number.isInteger(day)) {
        throw new BadRequestException('Day operator requires numeric day value');
      }

      return day;
    }

    if (['eq', 'neq'].includes(operator)) {
      return this.parsePrimitive(value);
    }

    return value;
  }

  private parsePrimitive(value: string): unknown {
    const normalized = value.toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (normalized === 'null') return null;

    const numericValue = Number(value);
    if (value !== '' && !Number.isNaN(numericValue) && /^-?\d+(\.\d+)?$/.test(value)) {
      return numericValue;
    }

    return this.unescapeSegment(value);
  }

  private parseBoolean(value: string, operator: FilterOperator): boolean {
    const normalized = value.toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    throw new BadRequestException(
      `Operator "${operator}" requires "true" or "false"`,
    );
  }

  private parseSort(sortString?: string): NormalizedSort[] {
    if (!sortString?.trim()) {
      return [];
    }

    return sortString
      .split(';')
      .filter(Boolean)
      .map((sort) => {
        const [field, direction] = sort.split(':');

        if (!field || !direction) {
          throw new BadRequestException(
            `Invalid sort format: "${sort}". Expected field:direction`,
          );
        }

        const normalizedDirection = direction.toLowerCase();

        if (!['asc', 'desc'].includes(normalizedDirection)) {
          throw new BadRequestException(
            `Invalid sort direction "${direction}"`,
          );
        }

        return {
          field: field.trim(),
          direction: normalizedDirection as 'asc' | 'desc',
        };
      });
  }

  private validateCondition(condition: NormalizedCondition): void {
    const { field, operator, value } = condition;

    this.validateOperator(field, operator);

    if (operator === 'between') {
      this.validateBetween(field, value);
    }

    if (this.arrayOperators.includes(operator)) {
      this.validateArray(field, operator, value);
    }

    if (operator === 'size' && (typeof value !== 'number' || value < 0)) {
      throw new BadRequestException(
        `Size operator requires a non-negative number for "${field}"`,
      );
    }

    if (operator === 'regex') {
      this.validateRegex(field, value);
    }

    if (this.dateOperators.includes(operator)) {
      this.validateDate(field, operator, value);
    }
  }

  private validateOperator(field: string, operator: FilterOperator): void {
    if (!this.validOperators.has(operator)) {
      throw new BadRequestException(
        `Invalid operator "${operator}" for field "${field}"`,
      );
    }
  }

  private validateBetween(field: string, value: unknown): void {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new BadRequestException(
        `Between operator requires exactly 2 values for "${field}"`,
      );
    }
  }

  private validateArray(
    field: string,
    operator: FilterOperator,
    value: unknown,
  ): void {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException(
        `Operator "${operator}" requires at least one value for "${field}"`,
      );
    }
  }

  private validateRegex(field: string, value: unknown): void {
    try {
      new RegExp(String(value));
    } catch {
      throw new BadRequestException(`Invalid regex pattern for "${field}"`);
    }
  }

  private validateDate(
    field: string,
    operator: FilterOperator,
    value: unknown,
  ): void {
    const stringValue = String(value);

    switch (operator) {
      case 'date':
        this.validateFullDate(field, stringValue);
        break;
      case 'year':
        this.validateYear(field, String(value));
        break;
      case 'month':
        this.validateMonth(field, stringValue);
        break;
      case 'day':
        this.validateDay(field, String(value));
        break;
    }
  }

  private validateFullDate(field: string, value: string): void {
    const parts = value.split('-');

    if (parts.length !== 3) {
      throw new BadRequestException(
        `Invalid date format for "${field}". Use YYYY-MM-DD`,
      );
    }

    const [year, month, day] = parts.map(Number);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      throw new BadRequestException(
        `Invalid date format for "${field}". Use YYYY-MM-DD`,
      );
    }

    if (month < 1 || month > 12) {
      throw new BadRequestException(`Invalid month "${month}" for "${field}"`);
    }

    if (day < 1 || day > 31) {
      throw new BadRequestException(`Invalid day "${day}" for "${field}"`);
    }

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new BadRequestException(`Invalid date value for "${field}"`);
    }
  }

  private validateYear(field: string, value: string): void {
    const year = Number(value);

    if (!Number.isInteger(year) || value.length !== 4) {
      throw new BadRequestException(
        `Invalid year format for "${field}". Use YYYY`,
      );
    }
  }

  private validateMonth(field: string, value: string): void {
    const parts = value.split('-');

    if (parts.length !== 2) {
      throw new BadRequestException(
        `Invalid month format for "${field}". Use YYYY-MM`,
      );
    }

    const [year, month] = parts.map(Number);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      String(parts[0]).length !== 4
    ) {
      throw new BadRequestException(
        `Invalid month format for "${field}". Use YYYY-MM`,
      );
    }

    if (month < 1 || month > 12) {
      throw new BadRequestException(`Invalid month "${month}" for "${field}"`);
    }
  }

  private validateDay(field: string, value: string): void {
    const day = Number(value);

    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new BadRequestException(`Invalid day "${value}" for "${field}"`);
    }
  }

  private parseCommaSeparatedList(value: string, label: string): string[] {
    const items = value
      .split(/(?<!\\),/)
      .map((item) => this.unescapeSegment(item.trim()))
      .filter(Boolean);

    if (items.length === 0) {
      throw new BadRequestException(`"${label}" requires at least one value`);
    }

    return items;
  }

  private parsePositiveInteger(value: string, label: string): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`"${label}" requires a positive integer`);
    }

    return parsed;
  }

  private parseNonNegativeInteger(value: string, label: string): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `"${label}" requires a non-negative integer`,
      );
    }

    return parsed;
  }

  private splitByUnescapedColon(value: string): string[] {
    return value.split(/(?<!\\):/).map((token) => token.replace(/\\:/g, ':'));
  }

  private unescapeSegment(value: string): string {
    return value.replace(/\\([:;,\\])/g, '$1');
  }

  private normalizeOperator(operator: string): FilterOperator {
    const normalized = this.operatorAliases[operator.toLowerCase()];

    if (!normalized) {
      throw new BadRequestException(`Invalid operator "${operator}"`);
    }

    return normalized;
  }

  private assertNeverRawExpression(expression: never): never {
    throw new BadRequestException(
      `Unhandled raw expression node: ${JSON.stringify(expression)}`,
    );
  }
}
