const { performance } = require('perf_hooks');

const { BadRequestException } = require('@nestjs/common');
const { FilterRegistry } = require('../../dist/core/services/filter-registry.service.js');
const { FilterProcessor } = require('../../dist/core/services/filter-processor.service.js');
const { SCFormat } = require('../../dist/formats/sc/sc-format.service.js');
const { SCFormatValidator } = require('../../dist/formats/sc/sc-format.validator.js');
const { SequelizeAdapter } = require('../../dist/adapters/sequelize/sequelize.adapter.js');
const {
  createFilterIR,
  createLogicalGroupNode,
  createNotNode,
  createPredicateNode,
  getPredicates,
} = require('../../dist/core/types/filter-ir.interface.js');
const {
  parseRawLogicalExpression,
  splitTopLevelSegments,
} = require('../../dist/formats/sc/sc-logical-expression.parser.js');
const {
  parseAggregationDirective,
  parseGroupByDirective,
  parseHavingDirective,
} = require('../../dist/formats/aggregation-directive.utils.js');

function makeScQuery(n) {
  const parts = [];
  for (let index = 0; index < n; index += 1) {
    parts.push(`field${index}:eq:${index}`);
  }
  parts.push('@sort:-createdAt,id');
  parts.push('@limit:50');
  parts.push('@page:2');
  parts.push('@fields:id,name,status');
  return parts.join(';');
}

function makeSchema(n) {
  const schema = {};
  for (let index = 0; index < n; index += 1) {
    schema[`field${index}`] = { type: 'number' };
  }
  schema.createdAt = { type: 'date' };
  schema.id = { type: 'number' };
  schema.name = { type: 'string' };
  schema.status = { type: 'string' };
  return schema;
}

function bench(label, iterations, fn) {
  for (let index = 0; index < 50; index += 1) {
    fn();
  }

  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const totalMs = performance.now() - start;

  return {
    label,
    iterations,
    totalMs: Number(totalMs.toFixed(2)),
    msPerOp: Number((totalMs / iterations).toFixed(4)),
  };
}

function createProcessor(FormatClass = SCFormat) {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new FormatClass(),
    validator: new SCFormatValidator({ maxConditions: 1000 }),
  });
  registry.registerAdapter(new SequelizeAdapter());

  return new FilterProcessor(registry, {
    enableValidation: true,
  });
}

class LegacyScFormat extends SCFormat {
  parse(query) {
    const filterString = query.filterString?.trim() ?? '';

    if (!filterString) {
      return this.createEmptyFilterIr(query);
    }

    const segments = splitTopLevelSegments(filterString)
      .map((segment) => segment.replace(/\\;/g, ';').trim())
      .filter(Boolean);
    const conditions = [];
    const caseExpressions = [];
    const aggregationMetrics = [];
    const expressionSegments = [];
    const directives = {
      sort: [],
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      include: query.customInclude,
      groupBy: undefined,
      having: [],
    };

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];

      if (segment.startsWith('@')) {
        this.applyDirective(segment, directives, aggregationMetrics);
        continue;
      }

      if (segment.startsWith('case:')) {
        const parsed = this.parseCaseExpressionLegacy(segments, index);
        caseExpressions.push(parsed.expression);
        index = parsed.nextIndex;
        continue;
      }

      expressionSegments.push(segment);
    }

    const expressionInput = expressionSegments.join(';');

    if (this.containsLogicalSyntaxLegacy(expressionInput)) {
      const expression = this.parseLogicalExpressionLegacy(expressionInput);
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
        aggregation: buildAggregationDefinition(
          aggregationMetrics,
          directives.groupBy,
          directives.having,
        ),
      });
    }

    for (const segment of expressionSegments) {
      conditions.push(this.parseConditionLegacy(segment));
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

  containsLogicalSyntaxLegacy(value) {
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

  parseLogicalExpressionLegacy(input) {
    try {
      const rawExpression = parseRawLogicalExpression(input);

      if (!rawExpression) {
        throw new BadRequestException('Logical expression cannot be empty');
      }

      return this.mapRawExpressionLegacy(rawExpression);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid logical expression',
      );
    }
  }

  mapRawExpressionLegacy(rawExpression) {
    switch (rawExpression.kind) {
      case 'predicate': {
        const condition = this.parseConditionLegacy(rawExpression.raw);
        return createPredicateNode(condition);
      }
      case 'not':
        return createNotNode(this.mapRawExpressionLegacy(rawExpression.child));
      case 'group':
        return createLogicalGroupNode(
          rawExpression.operator,
          rawExpression.children.map((child) => this.mapRawExpressionLegacy(child)),
        );
      default:
        throw new BadRequestException(
          `Unhandled raw expression node: ${JSON.stringify(rawExpression)}`,
        );
    }
  }

  parseConditionLegacy(condition) {
    return this.normalizeParsedCondition(this.parseDirectivePredicate(condition));
  }

  parseCaseExpressionLegacy(segments, startIndex) {
    const tokens = this.splitByUnescapedColon(segments[startIndex]);

    if (tokens.length < 2) {
      throw new BadRequestException(
        'CASE expression requires an output field: case:outputField',
      );
    }

    const outputField = this.unescapeSegment(tokens[1].trim());
    const cases = [];
    let elseValue;
    let index = startIndex;
    const inlineTokens = tokens.slice(2);

    if (inlineTokens.length > 0) {
      const inlineSegment = inlineTokens.join(':');
      if (inlineSegment.startsWith('when:')) {
        cases.push(this.parseCaseWhenSegmentLegacy(inlineSegment));
      } else if (inlineSegment.startsWith('else:')) {
        elseValue = this.parsePrimitive(inlineSegment.slice(5).trim());
      } else {
        throw new BadRequestException(`Invalid CASE segment "${segments[startIndex]}"`);
      }
    }

    while (index + 1 < segments.length) {
      const nextSegment = segments[index + 1];

      if (nextSegment.startsWith('when:')) {
        cases.push(this.parseCaseWhenSegmentLegacy(nextSegment));
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

  parseCaseWhenSegmentLegacy(segment) {
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
    const when = {
      field,
      operator,
      value: this.parseValue(rawValue, operator, field),
    };

    this.validateCondition(when);

    return {
      when,
      then: this.parsePrimitive(thenValue),
    };
  }

  applyDirective(segment, directives, aggregationMetrics) {
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
}

function buildAggregationDefinition(metrics, groupBy, having) {
  return require('../../dist/formats/aggregation-directive.utils.js').buildAggregationDefinition(
    metrics,
    groupBy,
    having,
  );
}

function runMode({ label, FormatClass }) {
  process.env.QUERY_REQUEST_DISABLE_VALIDATION_PARSE_REUSE = '0';

  const format = new FormatClass();
  const processor = createProcessor(FormatClass);
  const query = makeScQuery(200);
  const schema = makeSchema(205);

  return [
    bench(`sc parse ${label}`, 500, () => format.parse({ filterString: query })),
    bench(`sc process ${label}`, 200, () =>
      processor.processWith({
        query,
        formatName: 'scfilter',
        ormName: 'sequelize',
        adapterOptions: {
          dialect: 'postgres',
          model: {},
          rootAlias: 't',
        },
        pipeline: {
          validate: true,
          schema,
        },
      }),
    ),
  ];
}

console.log(
  JSON.stringify(
    [
      ...runMode({ label: 'before', FormatClass: LegacyScFormat }),
      ...runMode({ label: 'after', FormatClass: SCFormat }),
    ],
    null,
    2,
  ),
);
