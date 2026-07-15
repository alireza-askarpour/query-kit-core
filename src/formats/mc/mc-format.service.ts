import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createFilterIR,
  type AggregationExpression,
  FilterFormat,
  FilterOperator,
  type FilterPredicate,
  FormatOperatorPlugin,
  NormalizedCondition,
  NormalizedSort,
  Query,
} from '../../core';
import {
  getDefaultFilterOperatorRegistry,
  normalizeOperatorValidationOutcome,
} from '../../core';
import {
  buildAggregationDefinition,
  parseAggregationDirective,
  parseGroupByDirective,
} from '../aggregation-directive.utils';
import {
  parseEscapedList,
  parseMongoQueryDocument,
  type MongoParsedDirectiveSegment,
  type MongoParsedQueryDocument,
} from './mc-format-validation.parser';

@Injectable()
export class MCFormat implements FilterFormat {
  name = 'mcfilter';
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
    syntax: 'mc',
  };
  private readonly formatName = 'mcfilter';

  private readonly operatorAliases: Record<string, FilterOperator> = {
    eq: 'eq',
    ne: 'neq',
    neq: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    in: 'in',
    nin: 'notIn',
    notin: 'notIn',
    all: 'all',
    regex: 'regex',
    exists: 'exists',
    size: 'size',
    elemmatch: 'elemMatch',
  };

  parse(query: Query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return createFilterIR({
        predicates: [],
        sorting: this.parseSortDirective(query.sortString),
        pagination: {
          limit: query.size,
          page: query.page,
          offset: query.offset,
        },
        projection: query.fields ? { fields: query.fields } : undefined,
        relations: query.relations ?? query.customInclude,
        customInclude: query.customInclude,
      });
    }

    const parsedQuery = parseMongoQueryDocument(filterString, {
      normalizeOperator: this.normalizeOperator.bind(this),
      validateDateFormat: () => undefined,
      parseObjectLiteral: this.parseObjectLiteral.bind(this),
    });
    const conditions: NormalizedCondition[] = [];
    const aggregationMetrics: AggregationExpression[] = [];
    const directives = {
      sort: this.parseSortDirective(query.sortString),
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      customInclude: query.customInclude,
      groupBy: undefined as string[] | undefined,
      having: [] as FilterPredicate[],
    };

    for (const condition of parsedQuery.filterConditions) {
      conditions.push(this.normalizeParsedCondition(condition));
    }

    for (const directive of parsedQuery.directives) {
      this.applyParsedDirective(directive, directives, aggregationMetrics);
    }

    return createFilterIR({
      predicates: conditions,
      sorting: directives.sort,
      pagination: {
        limit: directives.limit,
        page: directives.page,
        offset: directives.offset,
      },
      projection: directives.fields ? { fields: directives.fields } : undefined,
      relations: directives.relationLoad,
      customInclude: directives.customInclude,
      aggregation: buildAggregationDefinition(
        aggregationMetrics,
        directives.groupBy,
        directives.having,
      ),
    });
  }

  buildFilterIrFromValidation(parsedQuery: MongoParsedQueryDocument, query: Query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return this.parse(query);
    }

    const conditions: NormalizedCondition[] = [];
    const aggregationMetrics: AggregationExpression[] = [];
    const directives = {
      sort: this.parseSortDirective(query.sortString),
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      customInclude: query.customInclude,
      groupBy: undefined as string[] | undefined,
      having: [] as FilterPredicate[],
    };

    for (const condition of parsedQuery.filterConditions) {
      conditions.push(this.normalizeParsedCondition(condition));
    }

    for (const directive of parsedQuery.directives) {
      this.applyParsedDirective(directive, directives, aggregationMetrics);
    }

    return createFilterIR({
      predicates: conditions,
      sorting: directives.sort,
      pagination: {
        limit: directives.limit,
        page: directives.page,
        offset: directives.offset,
      },
      projection: directives.fields ? { fields: directives.fields } : undefined,
      relations: directives.relationLoad,
      customInclude: directives.customInclude,
      aggregation: buildAggregationDefinition(
        aggregationMetrics,
        directives.groupBy,
        directives.having,
      ),
    });
  }

  private applyParsedDirective(
    directive: MongoParsedDirectiveSegment,
    directives: {
      sort: NormalizedSort[];
      limit?: number;
      page?: number;
      offset?: number;
      fields?: string[];
      relationLoad?: Query['relations'];
      customInclude?: Query['customInclude'];
      groupBy?: string[];
      having: FilterPredicate[];
    },
    aggregationMetrics: AggregationExpression[],
  ): void {
    const { name, rawName, value } = directive;

    switch (name) {
      case 'sort':
        directives.sort = this.parseSortDirective(value);
        break;
      case 'limit':
        directives.limit = this.parseInteger(value, '@limit', false);
        break;
      case 'page':
        directives.page = this.parseInteger(value, '@page', false);
        break;
      case 'offset':
        directives.offset = this.parseInteger(value, '@offset', true);
        break;
      case 'fields':
        directives.fields = this.parseList(value, '@fields');
        break;
      case 'populate':
      case 'include':
        directives.relationLoad = this.parseList(value, `@${name}`);
        directives.customInclude = directives.relationLoad;
        break;
      case 'aggregate':
        aggregationMetrics.push(
          ...parseAggregationDirective(
            value,
            this.parseList.bind(this),
            '@aggregate',
          ),
        );
        break;
      case 'groupby':
        directives.groupBy = parseGroupByDirective(
          value,
          this.parseList.bind(this),
          '@groupBy',
        );
        break;
      case 'having': {
        if (!directive.havingCondition) {
          throw new BadRequestException('Missing parsed @having condition');
        }
        directives.having.push(
          this.normalizeParsedCondition(directive.havingCondition),
        );
        break;
      }
      default:
        throw new BadRequestException(`Unsupported directive "${rawName}"`);
    }
  }

  private normalizeParsedCondition(condition: {
    field?: string;
    operator?: string;
    rawValue?: string;
  }): NormalizedCondition {
    if (!condition.field || !condition.operator || condition.rawValue === undefined) {
      throw new BadRequestException('Invalid parsed Mongo condition');
    }

    const operator = condition.operator as FilterOperator;
    const resolvedField = condition.field.trim();

    return {
      field: resolvedField,
      operator,
      value: this.parseValue(condition.rawValue, operator, resolvedField),
    };
  }

  private normalizeOperator(operator: string): FilterOperator {
    const normalized = operator.replace(/^\$/, '').trim().toLowerCase();
    const resolved =
      this.operatorAliases[normalized] ??
      getDefaultFilterOperatorRegistry().resolveFormatOperatorName(
        this.formatName,
        normalized,
      );

    if (!resolved) {
      throw new BadRequestException(`Unsupported Mongo operator "${operator}"`);
    }

    return resolved;
  }

  private parseValue(
    rawValue: string,
    operator: FilterOperator,
    field = '',
  ): unknown {
    const plugin = getDefaultFilterOperatorRegistry().getFormatOperator(
      this.formatName,
      operator,
    );

    if (plugin?.parseValue) {
      const parsedValue = plugin.parseValue(rawValue, {
        formatName: this.formatName,
        field,
        operator,
        rawValue,
        parseList: this.parseList.bind(this),
        parseInteger: this.parseInteger.bind(this),
        parseBoolean: this.parseBoolean.bind(this),
        parsePrimitive: this.parsePrimitive.bind(this),
        parseObjectLiteral: this.parseObjectLiteral.bind(this),
      });
      this.validatePluginValue(plugin, field, operator, rawValue, parsedValue);
      return parsedValue;
    }

    let value: unknown;
    if (operator === 'in' || operator === 'notIn' || operator === 'all') {
      value = this.parseList(rawValue, operator).map((item) => this.parsePrimitive(item));
      this.validatePluginValue(plugin, field, operator, rawValue, value);
      return value;
    }

    if (operator === 'size') {
      value = this.parseInteger(rawValue, 'size', true);
      this.validatePluginValue(plugin, field, operator, rawValue, value);
      return value;
    }

    if (operator === 'exists') {
      value = this.parseBoolean(rawValue, 'exists');
      this.validatePluginValue(plugin, field, operator, rawValue, value);
      return value;
    }

    if (operator === 'elemMatch') {
      value = this.parseObjectLiteral(rawValue);
      this.validatePluginValue(plugin, field, operator, rawValue, value);
      return value;
    }

    value = this.parsePrimitive(rawValue);
    this.validatePluginValue(plugin, field, operator, rawValue, value);

    return value;
  }

  private validatePluginValue(
    plugin: FormatOperatorPlugin | undefined,
    field: string,
    operator: FilterOperator,
    rawValue: string,
    value: unknown,
  ): void {
    if (!plugin?.validate) {
      return;
    }

    const outcome = normalizeOperatorValidationOutcome(
      plugin.validate({
        formatName: this.formatName,
        field,
        operator,
        rawValue,
        value,
      }),
      { field, operator, value },
    );

    if (outcome.errors?.length) {
      throw new BadRequestException(outcome.errors[0].message);
    }
  }

  private parseSortDirective(rawSort?: string): NormalizedSort[] {
    if (!rawSort?.trim()) {
      return [];
    }

    return this.parseList(rawSort, '@sort').map((item) => {
      const direction = item.startsWith('-') ? 'desc' : 'asc';
      const field = item.replace(/^[-+]/, '').trim();

      if (!field) {
        throw new BadRequestException('Sort field cannot be empty');
      }

      return { field, direction };
    });
  }

  private parsePrimitive(value: string): unknown {
    const trimmed = value.trim();
    const lowered = trimmed.toLowerCase();

    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    if (lowered === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    return trimmed;
  }

  private parseObjectLiteral(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value);

      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('not an object');
      }

      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        'Mongo elemMatch operator requires a JSON object value',
      );
    }
  }

  private parseList(value: string, label: string): string[] {
    const items = parseEscapedList(value);

    if (!items.length) {
      throw new BadRequestException(`${label} requires at least one value`);
    }

    return items;
  }

  private parseInteger(value: string, label: string, allowZero: boolean): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || (!allowZero && parsed <= 0) || parsed < 0) {
      throw new BadRequestException(`${label} requires a valid integer`);
    }

    return parsed;
  }

  private parseBoolean(value: string, label: string): boolean {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    throw new BadRequestException(`${label} requires "true" or "false"`);
  }
}
