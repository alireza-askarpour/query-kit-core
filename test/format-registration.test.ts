// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FilterRegistry,
} = require('../lib/core/services/filter-registry.service.js');

class MockFormat {
  constructor() {
    this.name = 'mock-format';
    this.capabilities = {
      supportsRegex: true,
      supportsCaseExpressions: false,
    };
    this.metadata = {
      family: 'custom',
    };
  }

  parse() {
    return { predicates: [] };
  }
}

test('registerFormatRegistration falls back to format instance capabilities', () => {
  const registry = new FilterRegistry();
  const format = new MockFormat();

  registry.registerFormatRegistration({ format });

  const registration = registry.getFormatRegistration('mock-format');

  assert.equal(registration.format, format);
  assert.deepEqual(registration.capabilities, {
    supportsRegex: true,
    supportsCaseExpressions: false,
  });
  assert.deepEqual(registration.metadata, {
    family: 'custom',
  });
});
