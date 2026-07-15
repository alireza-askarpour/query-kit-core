// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FilterProcessor,
} = require('../lib/core/services/filter-processor.service.js');
const {
  FilterRegistry,
} = require('../lib/core/services/filter-registry.service.js');
const { MCFormat } = require('../lib/formats/mc/mc-format.service.js');
const {
  MCFormatValidator,
} = require('../lib/formats/mc/mc-format.validator.js');

class MockAdapter {
  constructor() {
    this.ormName = 'mock';
  }

  convert(normalized) {
    return normalized;
  }
}

test('processor validates mcfilter queries when validator is registered', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new MCFormat(),
    validator: new MCFormatValidator(),
  });
  registry.registerAdapter(new MockAdapter());

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'mcfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  const result = processor.processWith({
    query: 'status:$eq:active;meta:$elemMatch:{"published":true}',
    pipeline: {
      schema: {
        status: { type: 'string' },
        meta: { type: 'object', allowedOperators: ['elemMatch'] },
      },
    },
  });

  assert.equal(result.conditions.length, 2);
  assert.equal(result.conditions[1].operator, 'elemMatch');
});
