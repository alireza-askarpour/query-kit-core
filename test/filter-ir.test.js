const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFilterIR,
  getPagination,
  getPredicates,
  getProjectionFields,
  getRelations,
  getSorting,
  getSqlFilterFeatures,
  normalizeRelationDirectives,
} = require('../dist/core/types/filter-ir.interface.js');

test('createFilterIR exposes neutral and legacy-compatible views', () => {
  const filter = createFilterIR({
    predicates: [{ field: 'status', operator: 'eq', value: 'active' }],
    sorting: [{ field: 'createdAt', direction: 'desc' }],
    pagination: { limit: 10, page: 2, offset: 10 },
    projection: { fields: ['id', 'status'] },
    relations: ['profile'],
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
  });

  assert.deepEqual(getPredicates(filter), filter.conditions);
  assert.deepEqual(getSorting(filter), filter.sort);
  assert.deepEqual(getPagination(filter), {
    limit: 10,
    page: 2,
    offset: 10,
  });
  assert.deepEqual(getProjectionFields(filter), ['id', 'status']);
  assert.deepEqual(getRelations(filter), ['profile']);
  assert.equal(getSqlFilterFeatures(filter).caseExpressions.length, 1);
});

test('IR helpers read legacy-shaped objects for compatibility', () => {
  const legacyFilter = {
    conditions: [{ field: 'status', operator: 'eq', value: 'active' }],
    sort: [{ field: 'createdAt', direction: 'desc' }],
    limit: 20,
    page: 1,
    offset: 0,
    fields: ['id'],
    relationLoad: ['profile'],
    caseExpressions: [],
  };

  assert.equal(getPredicates(legacyFilter).length, 1);
  assert.equal(getSorting(legacyFilter).length, 1);
  assert.equal(getPagination(legacyFilter).limit, 20);
  assert.deepEqual(getProjectionFields(legacyFilter), ['id']);
  assert.deepEqual(getRelations(legacyFilter), ['profile']);
});

test('normalizeRelationDirectives expands strings and nested relation objects', () => {
  assert.deepEqual(
    normalizeRelationDirectives([
      'profile',
      {
        path: 'orders',
        fields: ['id', 'total'],
        required: true,
        nested: [{ path: 'items', fields: ['sku'] }],
      },
    ]),
    [
      { path: 'profile', fields: undefined, nested: undefined, required: undefined },
      {
        path: 'orders',
        fields: ['id', 'total'],
        required: true,
        nested: [
          {
            path: 'items',
            fields: ['sku'],
            nested: undefined,
            required: undefined,
          },
        ],
      },
    ],
  );
});
