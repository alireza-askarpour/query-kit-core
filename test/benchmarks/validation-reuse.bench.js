const { performance } = require('perf_hooks');

const { FilterRegistry } = require('../../dist/core/services/filter-registry.service.js');
const { FilterProcessor } = require('../../dist/core/services/filter-processor.service.js');
const { SCFormat } = require('../../dist/formats/sc/sc-format.service.js');
const { SCFormatValidator } = require('../../dist/formats/sc/sc-format.validator.js');
const { MCFormat } = require('../../dist/formats/mc/mc-format.service.js');
const { MCFormatValidator } = require('../../dist/formats/mc/mc-format.validator.js');
const { SequelizeAdapter } = require('../../dist/adapters/sequelize/sequelize.adapter.js');

function createProcessor() {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new SCFormat(),
    validator: new SCFormatValidator({ maxConditions: 1000 }),
  });
  registry.registerFormatRegistration({
    format: new MCFormat(),
    validator: new MCFormatValidator({ maxConditions: 1000 }),
  });
  registry.registerAdapter(new SequelizeAdapter());

  return new FilterProcessor(registry, {
    enableValidation: true,
  });
}

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

function makeMcQuery(n) {
  const parts = [];
  for (let index = 0; index < n; index += 1) {
    parts.push(`field${index}:$in:${index},${index + 1},${index + 2}`);
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

function benchmark(label, iterations, fn) {
  for (let index = 0; index < 30; index += 1) {
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

function runSuite({ disableReuse, formatName, query, schema, iterations }) {
  process.env.QUERY_REQUEST_DISABLE_VALIDATION_PARSE_REUSE = disableReuse
    ? '1'
    : '0';

  const processor = createProcessor();
  const adapterOptions = {
    dialect: 'postgres',
    model: {},
    rootAlias: 't',
  };

  return benchmark(
    `${formatName} ${disableReuse ? 'before' : 'after'}`,
    iterations,
    () => {
      processor.processWith({
        query,
        formatName,
        ormName: 'sequelize',
        adapterOptions,
        pipeline: {
          validate: true,
          schema,
        },
      });
    },
  );
}

const cases = [
  {
    formatName: 'scfilter',
    query: makeScQuery(200),
    schema: makeSchema(205),
    iterations: 200,
  },
  {
    formatName: 'mcfilter',
    query: makeMcQuery(200),
    schema: makeSchema(205),
    iterations: 200,
  },
];

const results = cases.flatMap((benchCase) => [
  runSuite({ ...benchCase, disableReuse: true }),
  runSuite({ ...benchCase, disableReuse: false }),
]);

console.log(JSON.stringify(results, null, 2));
