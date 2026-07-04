const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FilterProcessor,
} = require('../dist/core/services/filter-processor.service.js');
const {
  FilterRegistry,
} = require('../dist/core/services/filter-registry.service.js');
const { SCFormat } = require('../dist/formats/sc/sc-format.service.js');
const {
  createFilterIR,
} = require('../dist/core/types/filter-ir.interface.js');

class MockAdapter {
  constructor(capabilities) {
    this.ormName = 'mock';
    this.calls = [];
    this.capabilities = capabilities;
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

class CapabilityFormat {
  constructor({ capabilities, metadata, parsed }) {
    this.name = 'capability';
    this.capabilities = capabilities;
    this.metadata = metadata;
    this.parsed = parsed;
  }

  parse() {
    return this.parsed;
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

test('processWith fails fast when format capabilities reject regex usage', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsRegex: false,
      },
      parsed: createFilterIR({
        predicates: [{ field: 'name', operator: 'regex', value: '^A' }],
      }),
    }),
  });
  registry.registerAdapter(
    new MockAdapter({
      supportsRegex: true,
    }),
  );

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Format "capability" does not support: regex operators/,
  );
});

test('processWith fails fast when adapter capabilities reject case expressions', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsCaseExpressions: true,
      },
      parsed: createFilterIR({
        predicates: [],
        extensions: {
          sql: {
            caseExpressions: [
              {
                outputField: 'priority',
                cases: [
                  {
                    when: { field: 'amount', operator: 'gte', value: 100 },
                    then: 'high',
                  },
                ],
              },
            ],
          },
        },
      }),
    }),
  });
  registry.registerAdapter(
    new MockAdapter({
      supportsCaseExpressions: false,
    }),
  );

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Adapter "mock" does not support: CASE expressions/,
  );
});

test('processWith fails fast when adapter capabilities reject array operators', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsArrayOperators: true,
      },
      parsed: createFilterIR({
        predicates: [{ field: 'tags', operator: 'in', value: ['new', 'hot'] }],
      }),
    }),
  });
  registry.registerAdapter(
    new MockAdapter({
      supportsArrayOperators: false,
    }),
  );

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Adapter "mock" does not support: array operators/,
  );
});

test('processWith fails fast when format capabilities reject aggregations', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsAggregations: false,
      },
      parsed: createFilterIR({
        predicates: [],
        extensions: {
          sql: {
            aggregations: [
              {
                field: 'amount',
                operator: 'sum',
                alias: 'totalAmount',
              },
            ],
          },
        },
      }),
    }),
  });
  registry.registerAdapter(
    new MockAdapter({
      supportsAggregations: true,
    }),
  );

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Format "capability" does not support: aggregations/,
  );
});

test('processWith fails fast on invalid aggregation having field', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsAggregations: true,
      },
      parsed: createFilterIR({
        predicates: [],
        aggregation: {
          groupBy: ['status'],
          metrics: [{ operator: 'count', alias: 'total' }],
          having: [{ field: 'amount', operator: 'gt', value: 10 }],
        },
      }),
    }),
  });
  registry.registerAdapter(new MockAdapter({ supportsAggregations: true }));

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Filter semantic validation failed/,
  );
});

test('processWith fails fast on invalid aggregation sort field', () => {
  const registry = new FilterRegistry();
  registry.registerFormatRegistration({
    format: new CapabilityFormat({
      capabilities: {
        supportsAggregations: true,
      },
      parsed: createFilterIR({
        predicates: [],
        aggregation: {
          groupBy: ['status'],
          metrics: [{ operator: 'count', alias: 'total' }],
        },
        sorting: [{ field: 'createdAt', direction: 'desc' }],
      }),
    }),
  });
  registry.registerAdapter(new MockAdapter({ supportsAggregations: true }));

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'ignored',
      }),
    /Filter semantic validation failed/,
  );
});
