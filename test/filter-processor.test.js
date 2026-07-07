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

  describeStrategy(normalized) {
    return {
      adapterName: this.ormName,
      mode: 'mock-convert',
      usesLogicalExpression: Boolean(normalized.logicalExpression),
      usesAggregation: Boolean(normalized.aggregate),
      usesRelations: (normalized.relationLoad?.length ?? 0) > 0,
      usesProjection: (normalized.fields?.length ?? 0) > 0,
      notes: ['Uses mock adapter strategy for diagnostics'],
    };
  }
}

class PassingValidator {
  constructor() {
    this.formatName = 'scfilter';
    this.calls = [];
  }

  validate(queryString, schema, context) {
    this.calls.push({ queryString, schema, context });
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

class ReusableParsedFormat {
  constructor() {
    this.name = 'reusable';
    this.parseCalls = 0;
    this.buildCalls = 0;
  }

  parse() {
    this.parseCalls += 1;
    return createFilterIR({
      predicates: [{ field: 'fallback', operator: 'eq', value: 'fallback' }],
    });
  }

  buildFilterIrFromValidation(parsedQuery) {
    this.buildCalls += 1;
    return createFilterIR({
      predicates: [
        {
          field: parsedQuery.field,
          operator: parsedQuery.operator,
          value: parsedQuery.value,
        },
      ],
    });
  }
}

class ReusableParsedValidator {
  constructor() {
    this.formatName = 'reusable';
  }

  validateQuery(queryStringOrQuery) {
    const filterString =
      typeof queryStringOrQuery === 'string'
        ? queryStringOrQuery
        : queryStringOrQuery.filterString;

    return {
      isValid: true,
      errors: [],
      warnings: [],
      parsedQuery: {
        field: 'status',
        operator: 'eq',
        value: filterString,
      },
    };
  }

  validate(queryString) {
    return this.validateQuery(queryString);
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
      context: undefined,
    },
  ]);
});

test('processWith reuses parsed validation output when format supports it', () => {
  const registry = new FilterRegistry();
  const format = new ReusableParsedFormat();
  registry.registerFormatRegistration({
    format,
    validator: new ReusableParsedValidator(),
  });

  const adapter = new MockAdapter();
  registry.registerAdapter(adapter);

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'reusable',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  const result = processor.processWith({
    query: 'status:eq:active',
  });

  assert.equal(format.parseCalls, 0);
  assert.equal(format.buildCalls, 1);
  assert.equal(result.normalized.conditions[0].field, 'status');
  assert.equal(result.normalized.conditions[0].value, 'status:eq:active');
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

test('processWith passes validation context to validator', () => {
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
      validationContext: {
        role: 'admin',
      },
    },
  });

  assert.deepEqual(validator.calls[0].context, { role: 'admin' });
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

test('auditWith returns parsed AST, applied rules, and chosen adapter strategy', () => {
  const validator = new PassingValidator();
  const { registry } = createRegistry({ validator });
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  const audit = processor.auditWith({
    query: 'status:eq:active;price:gt:100',
    pipeline: {
      schema: {
        status: { type: 'string' },
        price: { type: 'number' },
      },
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.parsedAst.kind, 'group');
  assert.equal(audit.appliedValidationRules.length >= 4, true);
  assert.equal(audit.chosenAdapterStrategy.mode, 'mock-convert');
  assert.deepEqual(audit.unsupportedFeatures, []);
  assert.equal(audit.result.normalized.conditions.length, 2);
});

test('auditWith reports unsupported features without throwing', () => {
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
      supportsRegex: false,
    }),
  );

  const processor = new FilterProcessor(registry, {
    defaultFormat: 'capability',
    defaultOrm: 'mock',
  });

  const audit = processor.auditWith({
    query: 'ignored',
  });

  assert.equal(audit.ok, false);
  assert.deepEqual(
    audit.unsupportedFeatures.map((item) => item.message),
    [
      'Format "capability" does not support: regex operators',
      'Adapter "mock" does not support: regex operators',
    ],
  );
  assert.equal(
    audit.appliedValidationRules.some(
      (rule) =>
        rule.code === 'CAPABILITY_CHECK' && rule.status === 'failed',
    ),
    true,
  );
  assert.equal(audit.result, undefined);
});

test('auditWith captures validation failures without throwing', () => {
  const { registry } = createRegistry({ validator: new FailingValidator() });
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    enableValidation: true,
  });

  const audit = processor.auditWith({
    query: 'status:eq:active',
  });

  assert.equal(audit.ok, false);
  assert.equal(audit.validationErrors.length, 1);
  assert.equal(audit.validationErrors[0].code, 'INVALID');
  assert.equal(
    audit.appliedValidationRules.find((rule) => rule.code === 'FORMAT_VALIDATOR')
      .status,
    'failed',
  );
});

test('processWith fails when policy max expression depth is exceeded', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      maxExpressionDepth: 2,
    },
  });

  assert.throws(
    () =>
      processor.processWith({
        query: '((status:eq:active|status:eq:pending);price:gt:100)',
      }),
    /Filter policy validation failed/,
  );
});

test('processWith fails when relation count exceeds policy limit', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      maxJoins: 1,
    },
  });

  assert.throws(
    () =>
      processor.processWith({
        query: {
          filterString: 'status:eq:active',
          relations: ['profile', 'orders'],
        },
      }),
    /Filter policy validation failed/,
  );
});

test('processWith fails when array length exceeds policy limit', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      maxArrayLength: 2,
    },
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'tags:in:new,hot,featured',
      }),
    /Filter policy validation failed/,
  );
});

test('processWith fails when regex complexity exceeds policy limit', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      regex: {
        maxComplexityScore: 10,
      },
    },
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'name:regex:(foo|bar|baz)+[A-Z]{2,4}',
      }),
    /Filter policy validation failed/,
  );
});

test('processWith denies expensive operators on public endpoints', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      denyExpensiveOperatorsOnPublicEndpoints: true,
      expensiveOperators: ['regex', 'contains'],
    },
  });

  assert.throws(
    () =>
      processor.processWith({
        query: 'name:regex:^A.*',
        pipeline: {
          validationContext: {
            endpointVisibility: 'public',
          },
        },
      }),
    /Filter policy validation failed/,
  );
});

test('auditWith reports policy violations without throwing', () => {
  const { registry } = createRegistry();
  const processor = new FilterProcessor(registry, {
    defaultFormat: 'scfilter',
    defaultOrm: 'mock',
    policy: {
      maxPopulates: 1,
    },
  });

  const audit = processor.auditWith({
    query: {
      filterString: 'status:eq:active',
      relations: ['profile', 'orders'],
    },
  });

  assert.equal(audit.ok, false);
  assert.equal(
    audit.validationErrors.some(
      (issue) => issue.code === 'POLICY_MAX_POPULATES_EXCEEDED',
    ),
    true,
  );
  assert.equal(
    audit.appliedValidationRules.some(
      (rule) => rule.code === 'POLICY_LAYER' && rule.status === 'failed',
    ),
    true,
  );
});
