import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FilterFormat,
  FilterOperator,
  NormalizedCondition,
  NormalizedFilter,
  NormalizedSort,
  Query,
} from '../../core';

@Injectable()
export class MCFormat implements FilterFormat {
  name = 'mcfilter';

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

  parse(query: Query): NormalizedFilter {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return {
        conditions: [],
        sort: this.parseSortDirective(query.sortString),
        limit: query.size,
        page: query.page,
        offset: query.offset,
        fields: query.fields,
        relationLoad: query.relations ?? query.customInclude,
        customInclude: query.customInclude,
      };
    }

    const segments = this.splitSegments(filterString);
    const conditions: NormalizedCondition[] = [];
    const directives: Pick<
      NormalizedFilter,
      'sort' | 'limit' | 'page' | 'offset' | 'fields' | 'relationLoad' | 'customInclude'
    > = {
      sort: this.parseSortDirective(query.sortString),
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      customInclude: query.customInclude,
    };

    segments.forEach((segment) => {
      if (segment.startsWith('@')) {
        this.applyDirective(segment, directives);
        return;
      }

      conditions.push(this.parseCondition(segment));
    });

    return {
      conditions,
      sort: directives.sort,
      limit: directives.limit,
      page: directives.page,
      offset: directives.offset,
      fields: directives.fields,
      relationLoad: directives.relationLoad,
      customInclude: directives.customInclude,
    };
  }

  private splitSegments(queryString: string): string[] {
    return queryString
      .split(/(?<!\\);/)
      .map((segment) => segment.replace(/\\;/g, ';').trim())
      .filter(Boolean);
  }

  private splitByUnescapedColon(input: string): string[] {
    return input.split(/(?<!\\):/).map((segment) => segment.replace(/\\:/g, ':'));
  }

  private applyDirective(
    segment: string,
    directives: Pick<
      NormalizedFilter,
      'sort' | 'limit' | 'page' | 'offset' | 'fields' | 'relationLoad' | 'customInclude'
    >,
  ): void {
    const [rawName, rawValue = ''] = this.splitByUnescapedColon(segment);
    const name = rawName.slice(1).trim().toLowerCase();
    const value = rawValue.trim();

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
        break;
      default:
        throw new BadRequestException(`Unsupported directive "${rawName}"`);
    }
  }

  private parseCondition(segment: string): NormalizedCondition {
    const [field, rawOperator, ...rest] = this.splitByUnescapedColon(segment);

    if (!field || !rawOperator || rest.length === 0) {
      throw new BadRequestException(
        `Invalid Mongo condition format: "${segment}". Expected field:$operator:value`,
      );
    }

    const operator = this.normalizeOperator(rawOperator);
    const rawValue = rest.join(':').trim();

    return {
      field: field.trim(),
      operator,
      value: this.parseValue(rawValue, operator),
    };
  }

  private normalizeOperator(operator: string): FilterOperator {
    const normalized = operator.replace(/^\$/, '').trim().toLowerCase();
    const resolved = this.operatorAliases[normalized];

    if (!resolved) {
      throw new BadRequestException(`Unsupported Mongo operator "${operator}"`);
    }

    return resolved;
  }

  private parseValue(rawValue: string, operator: FilterOperator): unknown {
    if (operator === 'in' || operator === 'notIn' || operator === 'all') {
      return this.parseList(rawValue, operator).map((item) => this.parsePrimitive(item));
    }

    if (operator === 'size') {
      return this.parseInteger(rawValue, 'size', true);
    }

    if (operator === 'exists') {
      return this.parseBoolean(rawValue, 'exists');
    }

    if (operator === 'elemMatch') {
      return this.parseObjectLiteral(rawValue);
    }

    return this.parsePrimitive(rawValue);
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
    const items = value
      .split(/(?<!\\),/)
      .map((item) => item.replace(/\\,/g, ',').trim())
      .filter(Boolean);

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
