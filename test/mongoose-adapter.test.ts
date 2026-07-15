// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MongooseAdapter,
} = require('../lib/adapters/mongoose/mongoose.adapter.js');

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

class MockMongooseAggregate {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.sortCalls = [];
    this.limitCalls = [];
    this.skipCalls = [];
    this.projectCalls = [];
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

  project(value) {
    this.projectCalls.push(value);
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

  aggregate(pipeline) {
    const query = new MockMongooseAggregate(pipeline);
    this.calls.push({ pipeline, query });
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

test('mongoose adapter supports logical groups and negation', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  adapter.convert(
    {
      predicates: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'status', operator: 'eq', value: 'pending' },
        { field: 'deletedAt', operator: 'exists', value: true },
      ],
      expression: {
        kind: 'group',
        operator: 'and',
        children: [
          {
            kind: 'group',
            operator: 'or',
            children: [
              {
                kind: 'predicate',
                predicate: { field: 'status', operator: 'eq', value: 'active' },
              },
              {
                kind: 'predicate',
                predicate: { field: 'status', operator: 'eq', value: 'pending' },
              },
            ],
          },
          {
            kind: 'not',
            child: {
              kind: 'predicate',
              predicate: {
                field: 'deletedAt',
                operator: 'exists',
                value: true,
              },
            },
          },
        ],
      },
    },
    { model },
  );

  assert.deepEqual(model.calls[0].filter, {
    $and: [
      {
        $or: [{ status: 'active' }, { status: 'pending' }],
      },
      {
        $nor: [{ deletedAt: { $exists: true } }],
      },
    ],
  });
});

test('mongoose adapter builds aggregation pipeline', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  const query = adapter.convert(
    {
      conditions: [{ field: 'status', operator: 'eq', value: 'active' }],
      sort: [{ field: 'totalAmount', direction: 'desc' }],
      limit: 5,
      aggregation: {
        groupBy: ['status'],
        metrics: [
          { operator: 'count', alias: 'total' },
          { operator: 'sum', field: 'amount', alias: 'totalAmount' },
          { operator: 'avg', field: 'score', alias: 'avgScore' },
        ],
      },
    },
    { model },
  );

  assert.equal(query, model.calls[0].query);
  assert.deepEqual(model.calls[0].pipeline, [
    { $match: { status: 'active' } },
    {
      $group: {
        _id: { status: '$status' },
        total: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgScore: { $avg: '$score' },
      },
    },
    {
      $project: {
        _id: 0,
        status: '$_id.status',
        total: 1,
        totalAmount: 1,
        avgScore: 1,
      },
    },
    { $sort: { totalAmount: -1 } },
    { $limit: 5 },
  ]);
});

test('mongoose adapter converts neutral relation definitions to populate objects', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  adapter.convert(
    {
      relationLoad: [
        {
          path: 'profile',
          fields: ['name', 'email'],
        },
        {
          path: 'orders',
          nested: [
            {
              path: 'items',
              fields: ['sku'],
            },
          ],
        },
      ],
    },
    { model },
  );

  assert.deepEqual(model.calls[0].query.populateCalls[0], [
    {
      path: 'profile',
      select: 'name email',
    },
    {
      path: 'orders',
      populate: [
        {
          path: 'items',
          select: 'sku',
        },
      ],
    },
  ]);
});

test('mongoose adapter fails fast on required relation definitions', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  assert.throws(
    () =>
      adapter.convert(
        {
          relationLoad: [{ path: 'profile', required: true }],
        },
        { model },
      ),
    /does not support required relations with populate/,
  );
});

test('mongoose adapter supports grouping without metrics and applies having', () => {
  const adapter = new MongooseAdapter();
  const model = new MockModel();

  adapter.convert(
    {
      aggregation: {
        groupBy: ['status'],
        metrics: [],
        having: [{ field: 'status', operator: 'eq', value: 'active' }],
      },
    },
    { model },
  );

  assert.deepEqual(model.calls[0].pipeline, [
    {
      $group: {
        _id: { status: '$status' },
      },
    },
    {
      $project: {
        _id: 0,
        status: '$_id.status',
      },
    },
    {
      $match: {
        status: 'active',
      },
    },
    { $limit: 100 },
  ]);
});
