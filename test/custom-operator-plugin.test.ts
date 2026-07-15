// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

const {
  SCFormat,
  SCFormatValidator,
  MCFormat,
  MCFormatValidator,
  TypeOrmAdapter,
  SequelizeAdapter,
  MongooseAdapter,
  createFilterIR,
  getDefaultFilterOperatorRegistry,
  registerFilterOperatorBundle,
} = require('../lib/index.js');

test.beforeEach(() => {
  getDefaultFilterOperatorRegistry().clear();
});

test.afterEach(() => {
  getDefaultFilterOperatorRegistry().clear();
});

test('sc format and validator support custom jsonContains operator', () => {
  registerFilterOperatorBundle({
    operator: 'jsonContains',
    formats: {
      scfilter: {
        aliases: ['jsoncontains'],
        supportedFieldTypes: ['object'],
        parseValue: (rawValue) => JSON.parse(rawValue),
        validate: ({ value }) => {
          if (!value || Array.isArray(value) || typeof value !== 'object') {
            return { code: 'JSON_OBJECT_REQUIRED', message: 'jsonContains requires a JSON object payload' };
          }
        },
      },
    },
  });

  const format = new SCFormat();
  const validator = new SCFormatValidator({ strictMode: true });
  const parsed = format.parse({ filterString: 'meta:jsonContains:{"theme":"dark"}' });
  const validation = validator.validate(
    'meta:jsonContains:{"theme":"dark"}',
    {
      meta: { type: 'object' },
    },
  );

  assert.deepEqual(parsed.conditions, [
    { field: 'meta', operator: 'jsonContains', value: { theme: 'dark' } },
  ]);
  assert.equal(validation.isValid, true);
  assert.deepEqual(validation.sanitizedConditions[0].value, { theme: 'dark' });
});

test('mc format and validator support custom geoWithin operator', () => {
  registerFilterOperatorBundle({
    operator: 'geoWithin',
    formats: {
      mcfilter: {
        aliases: ['geowithin'],
        supportedFieldTypes: ['object'],
        parseValue: (rawValue, context) => context.parseObjectLiteral(rawValue),
        validate: ({ value }) => {
          if (!value || typeof value !== 'object' || !('$geometry' in value)) {
            return { code: 'GEOMETRY_REQUIRED', message: 'geoWithin requires a $geometry object' };
          }
        },
      },
    },
  });

  const format = new MCFormat();
  const validator = new MCFormatValidator({ strictMode: true, allowObjectOperators: true });
  const query = 'location:$geoWithin:{"$geometry":{"type":"Polygon","coordinates":[]}}';
  const parsed = format.parse({ filterString: query });
  const validation = validator.validate(
    query,
    {
      location: { type: 'object' },
    },
  );

  assert.equal(parsed.conditions[0].operator, 'geoWithin');
  assert.deepEqual(parsed.conditions[0].value, {
    $geometry: { type: 'Polygon', coordinates: [] },
  });
  assert.equal(validation.isValid, true);
});

test('typeorm adapter supports custom jsonContains operator without core changes', () => {
  registerFilterOperatorBundle({
    operator: 'jsonContains',
    adapters: {
      typeorm: {
        apply: ({ field, value, parameterName }) => ({
          condition: `${field} @> :${parameterName}`,
          parameters: { [parameterName]: JSON.stringify(value) },
        }),
      },
    },
  });

  const adapter = new TypeOrmAdapter();
  const queryBuilder = {
    whereCalls: [],
    andWhere(condition, parameters) {
      this.whereCalls.push({ condition, parameters });
      return this;
    },
    addOrderBy() {
      return this;
    },
    take() {
      return this;
    },
    skip() {
      return this;
    },
    select() {
      return this;
    },
    addSelect() {
      return this;
    },
    leftJoin() {
      return this;
    },
    leftJoinAndSelect() {
      return this;
    },
  };

  adapter.convert(
    createFilterIR({
      predicates: [
        { field: 'meta', operator: 'jsonContains', value: { theme: 'dark' } },
      ],
    }),
    { queryBuilder, rootAlias: 'product', dialect: 'postgres' },
  );

  assert.deepEqual(queryBuilder.whereCalls[0], {
    condition: 'product.meta @> :meta_jsonContains',
    parameters: { meta_jsonContains: '{"theme":"dark"}' },
  });
});

test('sequelize adapter supports custom fullText operator for where and having', () => {
  registerFilterOperatorBundle({
    operator: 'fullText',
    adapters: {
      sequelize: {
        apply: ({ field, value, where, operators }) => {
          where[operators.and] = [
            ...(where[operators.and] ?? []),
            { [field]: { [operators.like]: `%${value}%` } },
          ];
        },
        buildSql: ({ column, value, escapeValue }) =>
          `MATCH(${column}) AGAINST (${escapeValue(value)} IN BOOLEAN MODE)`,
      },
    },
  });

  const adapter = new SequelizeAdapter();
  const model = {
    sequelize: {
      getDialect() {
        return 'mysql';
      },
      escape(value) {
        return `'${String(value).replace(/'/g, "''")}'`;
      },
    },
  };

  const whereResult = adapter.convert(
    createFilterIR({
      predicates: [{ field: 'title', operator: 'fullText', value: '+open +ai' }],
    }),
    { model, dialect: 'mysql' },
  );

  const havingResult = adapter.convert(
    createFilterIR({
      aggregation: {
        metrics: [{ operator: 'count', alias: 'total' }],
        having: [{ field: 'title', operator: 'fullText', value: '+open +ai' }],
      },
    }),
    { model, dialect: 'mysql' },
  );

  assert.equal(whereResult.where[Op.and].length, 1);
  assert.deepEqual(whereResult.where[Op.and][0], {
    title: { [Op.like]: '%+open +ai%' },
  });
  assert.match(havingResult.having.val, /MATCH\(["`]title["`]\) AGAINST \('\+open \+ai' IN BOOLEAN MODE\)/);
});

test('mongoose adapter supports custom geoWithin operator', () => {
  registerFilterOperatorBundle({
    operator: 'geoWithin',
    adapters: {
      mongoose: {
        apply: ({ value }) => ({ $geoWithin: value }),
      },
    },
  });

  const model = {
    calls: [],
    find(filter, projection) {
      this.calls.push({ filter, projection });
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        skip() {
          return this;
        },
        select() {
          return this;
        },
        populate() {
          return this;
        },
      };
    },
  };

  const adapter = new MongooseAdapter();
  adapter.convert(
    createFilterIR({
      predicates: [
        {
          field: 'location',
          operator: 'geoWithin',
          value: { $geometry: { type: 'Polygon', coordinates: [] } },
        },
      ],
    }),
    { model },
  );

  assert.deepEqual(model.calls[0].filter, {
    location: {
      $geoWithin: {
        $geometry: { type: 'Polygon', coordinates: [] },
      },
    },
  });
});
