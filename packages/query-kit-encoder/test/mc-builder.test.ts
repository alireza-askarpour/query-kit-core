// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMCQueryBuilder,
} = require('../lib/index.js');

test('mc builder creates mongo-style query strings', () => {
  const query = createMCQueryBuilder()
    .where('status', 'eq', 'active')
    .where('tags', 'in', ['new', 'hot'])
    .sortDesc('createdAt')
    .populate('profile', 'orders.items')
    .build();

  assert.equal(
    query,
    'status:$eq:active;tags:$in:new,hot;@sort:-createdAt;@populate:profile,orders.items',
  );
});

test('mc builder creates payload with external directives by default', () => {
  const payload = createMCQueryBuilder()
    .where('status', '$eq', 'active')
    .sortDesc('createdAt')
    .limit(10)
    .page(1)
    .fields('id', 'status')
    .populate('profile')
    .buildPayload();

  assert.deepEqual(payload, {
    filterString: 'status:$eq:active',
    sortString: '-createdAt',
    page: 1,
    size: 10,
    offset: undefined,
    fields: ['id', 'status'],
    relations: ['profile'],
    customInclude: ['profile'],
  });
});

test('mc builder supports aggregates and having', () => {
  const query = createMCQueryBuilder()
    .where('status', 'eq', 'active')
    .aggregate('count', '*', 'total')
    .groupBy('status')
    .having('total', 'gte', 1)
    .build();

  assert.equal(
    query,
    'status:$eq:active;@aggregate:count(*):total;@groupBy:status;@having:total:$gte:1',
  );
});

test('mc builder supports elemMatch object values', () => {
  const query = createMCQueryBuilder()
    .where('meta', 'elemMatch', { published: true })
    .build();

  assert.equal(query, 'meta:$elemMatch:{"published":true}');
});
