const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FilterProcessor,
} = require('../dist/core/services/filter-processor.service.js');
const {
  FilterRegistry,
} = require('../dist/core/services/filter-registry.service.js');
const { SCFormat } = require('../dist/formats/sc/sc-format.service.js');

class MockAdapter {
  constructor() {
    this.ormName = 'mock';
    this.calls = [];
  }

  convert(normalized, options) {
    this.calls.push({ normalized, options });
    return { normalized, options };
  }
}

class PassingValidator {
  constructor() {
    this.formatName = 'scfilter';
    this.calls = [];
  }

  validate(queryString, schema) {
    this.calls.push({ queryString, schema });
    return {
      isValid: true,
      errors: [],
      warnings: [],
      sanitized: [],
    };
  }
}

class FailingValidator {
  constructor() {
    this.formatName = 'scfilter';
  }

  validate() {
    return {
      isValid: false,
      errors: [{ field: 'status', message: 'invalid', code: 'INVALID' }],
      warnings: [{ field: 'status', message: 'warn', code: 'WARN' }],
    };
  }
}

function createRegistry({ validator } = {}) {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new SCFormat(),
    validator,
  });

  const adapter = new MockAdapter();
  registry.registerAdapter(adapter);

  return { registry, adapter };
}

test('process uses explicit format and adapter names', () => {
  const { registry, adapter } = createRegistry();
  const processor = new FilterProcessor(registry, {});

  const result = processor.process(
    'status:eq:active;@limit:10',
    'scfilter',
    'mock',
    { traceId: 'abc' },
  );

  assert.equal(adapter.calls.length, 1);
  assert.equal(result.normalized.conditions[0].field, 'status');
  assert.equal(result.normalized.conditions[0].operator, 'eq');
  assert.equal(result.normalized.limit, 10);
  assert.deepEqual(result.options, { traceId: 'abc' });
});

test('processWith uses configured defaults and object query input', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
  });

  const result = processor.processWith({
    query: {
      filterString: 'status:eq:active',
      sortString: 'createdAt:desc',
      page: 2,
    },
  });

  assert.equal(result.normalized.sort[0].field, 'createdAt');
  assert.equal(result.normalized.sort[0].direction, 'desc');
  assert.equal(result.normalized.page, 2);
});

test('processWith validates when enabled and validator exists', () => {
  const validator = new PassingValidator();
  const { registry } = createRegistry({ validator });
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  processor.processWith({
    query: 'status:eq:active',
    pipeline: {
      schema: {
        status: { type: 'string' },
      },
    },
  });

  assert.deepEqual(validator.calls, [
    {
      queryString: 'status:eq:active',
      schema: { status: { type: 'string' } },
    },
  ]);
});

test('processWith skips validation cleanly when validator is not registered', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  const result = processor.processWith({
    query: 'status:eq:active',
  });

  assert.equal(result.normalized.conditions.length, 1);
});

test('processWith throws when validation fails', () => {
  const { registry } = createRegistry({ validator: new FailingValidator() });
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'status:eq:active',
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        error.getResponse().message,
        'Filter validation failed for format "scfilter"',
      );
      return true;
    },
  );
});

test('processWith throws when format name is missing and no default exists', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {});

  assert.throws(
    () =>
      processor.processWith({
        query: 'status:eq:active',
      }),
    /Filter format name is required/,
  );
});

test('processWith throws when adapter name is missing and no default exists', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'status:eq:active',
      }),
    /Adapter name is required/,
  );
});

test('processWith can disable validation per request', () => {
  const validator = new PassingValidator();
  const { registry } = createRegistry({ validator });
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  processor.processWith({
    query: 'status:eq:active',
    pipeline: {
      validate: false,
    },
  });

  assert.equal(validator.calls.length, 0);
});
