const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MongooseAdapter,
} = require('../dist/adapters/mongoose/mongoose.adapter.js');

class MockMongooseQuery {
  constructor(filter, projection) {
    this.filter = filter;
    this.projection = projection;
    this.sortCalls = [];
    this.limitCalls = [];
    this.skipCalls = [];
    this.selectCalls = [];
    this.populateCalls = [];
  }

  sort(value) {
    this.sortCalls.push(value);
    return this;
  }

  limit(value) {
    this.limitCalls.push(value);
    return this;
  }

  skip(value) {
    this.skipCalls.push(value);
    return this;
  }

  select(value) {
    this.selectCalls.push(value);
    return this;
  }

  populate(value) {
    this.populateCalls.push(value);
    return this;
  }
}

class MockModel {
  constructor() {
    this.calls = [];
  }

  find(filter, projection) {
    const query = new MockMongooseQuery(filter, projection);
    this.calls.push({ filter, projection, query });
    return query;
  }
}

test('mongoose adapter builds query chain from normalized filter', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  const query = adapter.convert(
    {
      conditions: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'age', operator: 'gte', value: 18 },
        { field: 'tags', operator: 'in', value: ['new', 'hot'] },
        { field: 'meta', operator: 'elemMatch', value: { published: true } },
      ],
      sort: [{ field: 'createdAt', direction: 'desc' }],
      fields: ['status', 'profile.name'],
      relationLoad: ['profile', 'orders'],
      limit: 10,
      page: 3,
    },
    {
      model,
      populateMap: {
        orders: { path: 'orders', select: 'number total' },
      },
    },
  );

  assert.equal(query, model.calls[0].query);
  assert.deepEqual(model.calls[0].filter, {
    status: 'active',
    age: { $gte: 18 },
    tags: { $in: ['new', 'hot'] },
    meta: { $elemMatch: { published: true } },
  });
  assert.equal(model.calls[0].projection, 'status profile.name');
  assert.deepEqual(query.sortCalls[0], { createdAt: -1 });
  assert.equal(query.limitCalls[0], 10);
  assert.equal(query.skipCalls[0], 20);
  assert.equal(query.selectCalls[0], 'status profile.name');
  assert.deepEqual(query.populateCalls[0], [
    'profile',
    { path: 'orders', select: 'number total' },
  ]);
});
