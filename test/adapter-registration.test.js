const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FilterRegistry,
} = require('../dist/core/services/filter-registry.service.js');

class MockAdapter {
  constructor(name = 'mock') {
    this.ormName = name;
  }

  convert(normalized, options) {
    return { normalized, options };
  }
}

test('registerAdapter keeps backward compatibility', () => {
  const registry = new FilterRegistry();
  const adapter = new MockAdapter('legacy');

  registry.registerAdapter(adapter);

  assert.equal(registry.getAdapter('legacy'), adapter);
  assert.equal(registry.getAdapterRegistration('legacy').adapter, adapter);
});

test('registerAdapterRegistration stores metadata and capabilities', () => {
  const registry = new FilterRegistry();
  const adapter = new MockAdapter('typeorm');

  registry.registerAdapterRegistration({
    adapter,
    capabilities: {
      supportsCaseExpressions: true,
      supportsIncludes: true,
    },
    metadata: {
      family: 'sql',
    },
  });

  const registration = registry.getAdapterRegistration('typeorm');

  assert.equal(registration.adapter, adapter);
  assert.deepEqual(registration.capabilities, {
    supportsCaseExpressions: true,
    supportsIncludes: true,
  });
  assert.deepEqual(registration.metadata, {
    family: 'sql',
  });
});

test('registerAdapterRegistration falls back to adapter instance capabilities', () => {
  const registry = new FilterRegistry();
  const adapter = new MockAdapter('mongoose');
  adapter.capabilities = {
    supportsRegex: true,
    supportsArrayOperators: true,
  };
  adapter.metadata = {
    family: 'mongodb',
  };

  registry.registerAdapterRegistration({ adapter });

  const registration = registry.getAdapterRegistration('mongoose');

  assert.deepEqual(registration.capabilities, {
    supportsRegex: true,
    supportsArrayOperators: true,
  });
  assert.deepEqual(registration.metadata, {
    family: 'mongodb',
  });
});
