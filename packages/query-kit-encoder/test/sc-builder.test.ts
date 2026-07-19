// @ts-nocheck
export {};
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSCQueryBuilder,
} = require('../lib/index.js');

test('sc builder creates logical expression with inline directives', () => {
  const query = createSCQueryBuilder()
    .where('status', 'eq', 'active')
    .orGroup((group) => {
      group.where('price', 'gte', 100).where('price', 'lte', 500);
    })
    .sortDesc('createdAt')
    .limit(20)
    .page(2)
    .fields('id', 'name')
    .include('profile', 'orders.items')
    .build();

  assert.equal(
    query,
    'status:eq:active|(price:gte:100;price:lte:500);@sort:-createdAt;@limit:20;@page:2;@fields:id,name;@include:profile,orders.items',
  );
});

test('sc builder creates payload with external directives by default', () => {
  const payload = createSCQueryBuilder()
    .where('status', 'eq', 'active')
    .sortDesc('createdAt')
    .limit(10)
    .page(3)
    .fields('id', 'status')
    .include('profile')
    .buildPayload();

  assert.deepEqual(payload, {
    filterString: 'status:eq:active',
    sortString: 'createdAt:desc',
    page: 3,
    size: 10,
    offset: undefined,
    fields: ['id', 'status'],
    relations: ['profile'],
    customInclude: ['profile'],
  });
});

test('sc builder supports aggregation, having, and case expressions', () => {
  const query = createSCQueryBuilder()
    .where('status', 'eq', 'active')
    .case('priority', (expr) => {
      expr
        .when('amount', 'gte', 1000, 'high')
        .when('amount', 'lt', 1000, 'low')
        .else('unknown');
    })
    .aggregate('sum', 'amount', 'totalAmount')
    .groupBy('status')
    .having('totalAmount', 'gte', 100)
    .build();

  assert.equal(
    query,
    'status:eq:active;case:priority;when:amount:gte:1000:then:high;when:amount:lt:1000:then:low;else:unknown;@aggregate:sum(amount):totalAmount;@groupBy:status;@having:totalAmount:gte:100',
  );
});

test('sc builder creates URLSearchParams from payload', () => {
  const params = createSCQueryBuilder()
    .where('status', 'eq', 'active')
    .sortAsc('name')
    .limit(25)
    .toURLSearchParams();

  assert.equal(params.get('filter'), 'status:eq:active');
  assert.equal(params.get('sort'), 'name:asc');
  assert.equal(params.get('size'), '25');
});
