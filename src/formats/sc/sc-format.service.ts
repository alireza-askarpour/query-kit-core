import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createLogicalGroupNode,
  createNotNode,
  createPredicateNode,
  createFilterIR,
  FilterValidationIssue,
  FilterFormat,
  FilterExpressionNode,
  FilterOperator,
  NormalizedCaseExpression,
  NormalizedCondition,
  NormalizedSort,
  Query,
} from '../../core';
import {
  getDefaultFilterOperatorRegistry,
  normalizeOperatorValidationOutcome,
} from '../../core';
import { splitTopLevelSegments } from './sc-logical-expression.parser';
import type {
  ParsedCaseExpressionNode,
  ParsedExpressionNode,
  ParsedQueryDocument,
} from './sc-format-validation.parser';
import { parseQueryDocument } from './sc-format-validation.parser';
import {
  buildAggregationDefinition,
  parseAggregationDirective,
  parseGroupByDirective,
  parseHavingDirective,
} from '../aggregation-directive.utils';

@Injectable()
export class SCFormat implements FilterFormat {
  name = 'scfilter';
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
    syntax: 'sc',
  };

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

  private readonly formatName = 'scfilter';

  public parse(query: Query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return this.createEmptyFilterIr(query);
    }

    const parsedQuery = parseQueryDocument(filterString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat: (value: string) => this.validateFullDate('query', value),
    });

    return this.buildFilterIrFromValidation(parsedQuery, query);
  }

  buildFilterIrFromValidation(parsedQuery: ParsedQueryDocument, query: Query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return this.createEmptyFilterIr(query);
    }

    const conditions: NormalizedCondition[] = [];
    const caseExpressions = parsedQuery.caseExpressions.map((expression) =>
      this.buildCaseExpressionFromParsed(expression),
    );
    const aggregationMetrics = [] as import('../../core').AggregationExpression[];
    const directives = {
      sort: [] as NormalizedSort[],
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      include: query.customInclude,
      groupBy: undefined as string[] | undefined,
      having: [] as import('../../core').FilterPredicate[],
    };
    let havingIndex = 0;

    for (const segment of parsedQuery.directiveSegments) {
      const [directiveName, ...rawValueParts] = this.splitByUnescapedColon(segment);
      const name = directiveName.slice(1).trim().toLowerCase();
      const value = rawValueParts.join(':').trim();

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
          directives.include = directives.relationLoad;
          break;
        case 'aggregate':
          aggregationMetrics.push(
            ...parseAggregationDirective(
              value,
              this.parseCommaSeparatedList.bind(this),
              '@aggregate',
            ),
          );
          break;
        case 'groupby':
          directives.groupBy = parseGroupByDirective(
            value,
            this.parseCommaSeparatedList.bind(this),
            '@groupBy',
          );
          break;
        case 'having': {
          const parsedHaving = parsedQuery.parsedHavingConditions[havingIndex];
          if (!parsedHaving) {
            throw new BadRequestException('Missing parsed @having condition');
          }
          directives.having.push(this.normalizeParsedCondition(parsedHaving));
          havingIndex += 1;
          break;
        }
        default:
          throw new BadRequestException(`Unsupported directive "${directiveName}"`);
      }
    }

    if (parsedQuery.expression) {
      const expression = this.mapParsedExpression(parsedQuery.expression, conditions);

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
        aggregation: buildAggregationDefinition(
          aggregationMetrics,
          directives.groupBy,
          directives.having,
        ),
      });
    }

    for (const condition of parsedQuery.filterConditions) {
      conditions.push(this.normalizeParsedCondition(condition));
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
      aggregation: buildAggregationDefinition(
        aggregationMetrics,
        directives.groupBy,
        directives.having,
      ),
    });
  }

  private mapParsedExpression(
    parsedExpression: ParsedExpressionNode,
    conditions: NormalizedCondition[],
  ): FilterExpressionNode {
    switch (parsedExpression.kind) {
      case 'predicate': {
        const condition = this.normalizeParsedCondition(parsedExpression.predicate);
        conditions.push(condition);
        return createPredicateNode(condition);
      }
      case 'not':
        return createNotNode(this.mapParsedExpression(parsedExpression.child, conditions));
      case 'group':
        return createLogicalGroupNode(
          parsedExpression.operator,
          parsedExpression.children.map((child) =>
            this.mapParsedExpression(child, conditions),
          ),
        );
    }
  }

  private buildCaseExpressionFromParsed(
    expression: ParsedCaseExpressionNode,
  ): NormalizedCaseExpression {
    if (expression.error) {
      throw new BadRequestException(expression.error);
    }

    if (!expression.outputField) {
      throw new BadRequestException(
        'CASE expression requires an output field: case:outputField',
      );
    }

    return {
      outputField: expression.outputField,
      cases: expression.cases.map((entry) => ({
        when: this.normalizeParsedCondition(entry.condition),
        then: this.parsePrimitive(entry.thenRawValue),
      })),
      elseValue:
        expression.elseRawValue !== undefined
          ? this.parsePrimitive(expression.elseRawValue)
          : undefined,
    };
  }

  private isDirective(segment: string): boolean {
    return segment.startsWith('@');
  }

  private createEmptyFilterIr(query: Query) {
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

  private normalizeParsedCondition(condition: {
    field?: string;
    operator?: string;
    rawValue?: string;
  }): NormalizedCondition {
    if (!condition.field || !condition.operator || condition.rawValue === undefined) {
      throw new BadRequestException('Invalid parsed condition');
    }

    const operator = condition.operator as FilterOperator;
    const resolvedField = this.unescapeSegment(condition.field.trim());
    const normalizedCondition = {
      field: resolvedField,
      operator,
      value: this.parseValue(condition.rawValue.trim(), operator, resolvedField),
    };

    this.validateCondition(normalizedCondition);
    return normalizedCondition;
  }

  private parseDirectivePredicate(rawValue: string): {
    field?: string;
    operator?: string;
    rawValue?: string;
  } {
    const [field, rawOperator, ...rawValueParts] = this.splitByUnescapedColon(
      rawValue,
    );

    if (!field || !rawOperator || rawValueParts.length === 0) {
      throw new BadRequestException(
        `Invalid condition format: "${rawValue}". Expected field:operator:value`,
      );
    }

    return {
      field,
      operator: this.normalizeOperator(rawOperator.trim()),
      rawValue: rawValueParts.join(':').trim(),
    };
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
      groupBy?: string[];
      having: import('../../core').FilterPredicate[];
    },
    aggregationMetrics: import('../../core').AggregationExpression[],
  ): void {
    const [directiveName, ...rawValueParts] = this.splitByUnescapedColon(segment);
    const name = directiveName.slice(1).trim().toLowerCase();
    const value = rawValueParts.join(':').trim();

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
        directives.include = directives.relationLoad;
        break;
      case 'aggregate':
        aggregationMetrics.push(
          ...parseAggregationDirective(
            value,
            this.parseCommaSeparatedList.bind(this),
            '@aggregate',
          ),
        );
        break;
      case 'groupby':
        directives.groupBy = parseGroupByDirective(
          value,
          this.parseCommaSeparatedList.bind(this),
          '@groupBy',
        );
        break;
      case 'having':
        directives.having.push(
          parseHavingDirective(
            value,
            (predicateValue) =>
              this.normalizeParsedCondition(
                this.parseDirectivePredicate(predicateValue),
              ),
            '@having',
          ),
        );
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

  private parseValue(
    rawValue: string,
    operator: FilterOperator,
    field = '',
  ): unknown {
    const value = this.unescapeSegment(rawValue.trim());
    const plugin = getDefaultFilterOperatorRegistry().getFormatOperator(
      this.formatName,
      operator,
    );

    if (plugin?.parseValue) {
      return plugin.parseValue(value, {
        formatName: this.formatName,
        field,
        operator,
        rawValue: value,
        parseList: this.parseCommaSeparatedList.bind(this),
        parseInteger: (input, label, allowZero = false) =>
          allowZero
            ? this.parseNonNegativeInteger(input, label)
            : this.parsePositiveInteger(input, label),
        parseBoolean: this.parseBoolean.bind(this),
        parsePrimitive: this.parsePrimitive.bind(this),
      });
    }

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
    const plugin = getDefaultFilterOperatorRegistry().getFormatOperator(
      this.formatName,
      operator,
    );

    this.validateOperator(field, operator);

    if (plugin?.validate) {
      const outcome = normalizeOperatorValidationOutcome(
        plugin.validate({
          formatName: this.formatName,
          field,
          operator,
          rawValue: String(value ?? ''),
          value,
        }),
        { field, operator, value },
      );
      this.throwValidationIssues(outcome.errors);
    }

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
    if (
      !this.validOperators.has(operator) &&
      !getDefaultFilterOperatorRegistry().getFormatOperator(this.formatName, operator)
    ) {
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
    const normalized =
      this.operatorAliases[operator.toLowerCase()] ??
      getDefaultFilterOperatorRegistry().resolveFormatOperatorName(
        this.formatName,
        operator,
      );

    if (!normalized) {
      throw new BadRequestException(`Invalid operator "${operator}"`);
    }

    return normalized;
  }

  private throwValidationIssues(issues: FilterValidationIssue[] | undefined): void {
    if (!issues?.length) {
      return;
    }

    throw new BadRequestException(issues[0].message);
  }
}
