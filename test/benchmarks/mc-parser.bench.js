const { performance } = require('perf_hooks');

const { FilterRegistry } = require('../../dist/core/services/filter-registry.service.js');
const { FilterProcessor } = require('../../dist/core/services/filter-processor.service.js');
const { MCFormat } = require('../../dist/formats/mc/mc-format.service.js');
const { SequelizeAdapter } = require('../../dist/adapters/sequelize/sequelize.adapter.js');
const {
  createFilterIR,
} = require('../../dist/core/types/filter-ir.interface.js');
const {
  buildAggregationDefinition,
  parseAggregationDirective,
  parseGroupByDirective,
  parseHavingDirective,
} = require('../../dist/formats/aggregation-directive.utils.js');

function makeMcQuery(n) {
  const parts = [];
  for (let index = 0; index < n; index += 1) {
    parts.push(`field${index}:$in:${index},${index + 1},${index + 2}`);
  }
  parts.push('@aggregate:sum(field1):total');
  parts.push('@groupby:status');
  parts.push('@sort:-total,status');
  parts.push('@limit:50');
  parts.push('@page:2');
  parts.push('@fields:status,total');
  parts.push('@include:profile,orders.items');
  parts.push('@having:total:$gt:100');
  return parts.join(';');
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

function createProcessor(FormatClass) {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new FormatClass(),
  });
  registry.registerAdapter(new SequelizeAdapter());

  return new FilterProcessor(registry, {
    enableValidation: false,
  });
}

class LegacyMCFormat extends MCFormat {
  parse(query) {
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

    const segments = this.splitSegmentsLegacy(filterString);
    const conditions = [];
    const aggregationMetrics = [];
    const directives = {
      sort: this.parseSortDirective(query.sortString),
      limit: query.size,
      page: query.page,
      offset: query.offset,
      fields: query.fields ? [...query.fields] : undefined,
      relationLoad: query.relations ?? query.customInclude,
      customInclude: query.customInclude,
      groupBy: undefined,
      having: [],
    };

    segments.forEach((segment) => {
      if (segment.startsWith('@')) {
        this.applyDirectiveLegacy(segment, directives, aggregationMetrics);
        return;
      }

      conditions.push(this.parseConditionLegacy(segment));
    });

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

  splitSegmentsLegacy(queryString) {
    return queryString
      .split(/(?<!\\);/)
      .map((segment) => segment.replace(/\\;/g, ';').trim())
      .filter(Boolean);
  }

  splitByUnescapedColonLegacy(input) {
    return input.split(/(?<!\\):/).map((segment) => segment.replace(/\\:/g, ':'));
  }

  parseListLegacy(value, label) {
    const items = value
      .split(/(?<!\\),/)
      .map((item) => item.replace(/\\,/g, ',').trim())
      .filter(Boolean);

    if (!items.length) {
      throw new Error(`${label} requires at least one value`);
    }

    return items;
  }

  applyDirectiveLegacy(segment, directives, aggregationMetrics) {
    const [rawName, ...rawValueParts] = this.splitByUnescapedColonLegacy(segment);
    const name = rawName.slice(1).trim().toLowerCase();
    const value = rawValueParts.join(':').trim();

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
        directives.fields = this.parseListLegacy(value, '@fields');
        break;
      case 'populate':
      case 'include':
        directives.relationLoad = this.parseListLegacy(value, `@${name}`);
        directives.customInclude = directives.relationLoad;
        break;
      case 'aggregate':
        aggregationMetrics.push(
          ...parseAggregationDirective(
            value,
            this.parseListLegacy.bind(this),
            '@aggregate',
          ),
        );
        break;
      case 'groupby':
        directives.groupBy = parseGroupByDirective(
          value,
          this.parseListLegacy.bind(this),
          '@groupBy',
        );
        break;
      case 'having':
        directives.having.push(
          parseHavingDirective(
            value,
            (predicateValue) => this.parseConditionLegacy(predicateValue),
            '@having',
          ),
        );
        break;
      default:
        throw new Error(`Unsupported directive "${rawName}"`);
    }
  }

  parseConditionLegacy(segment) {
    const [field, rawOperator, ...rest] = this.splitByUnescapedColonLegacy(segment);

    if (!field || !rawOperator || rest.length === 0) {
      throw new Error(
        `Invalid Mongo condition format: "${segment}". Expected field:$operator:value`,
      );
    }

    return this.normalizeParsedCondition({
      field,
      operator: this.normalizeOperator(rawOperator),
      rawValue: rest.join(':').trim(),
    });
  }
}

const iterations = 500;
const query = {
  filterString: makeMcQuery(200),
};

const parseResults = [
  bench('mc parse before', iterations, () => {
    new LegacyMCFormat().parse(query);
  }),
  bench('mc parse after', iterations, () => {
    new MCFormat().parse(query);
  }),
];

const adapterOptions = {
  dialect: 'postgres',
  model: {},
  rootAlias: 't',
};

const legacyProcessor = createProcessor(LegacyMCFormat);
const currentProcessor = createProcessor(MCFormat);
const processResults = [
  bench('mc process before', iterations, () => {
    legacyProcessor.processWith({
      query,
      formatName: 'mcfilter',
      ormName: 'sequelize',
      adapterOptions,
      pipeline: {
        validate: false,
      },
    });
  }),
  bench('mc process after', iterations, () => {
    currentProcessor.processWith({
      query,
      formatName: 'mcfilter',
      ormName: 'sequelize',
      adapterOptions,
      pipeline: {
        validate: false,
      },
    });
  }),
];

console.log(JSON.stringify([...parseResults, ...processResults], null, 2));
