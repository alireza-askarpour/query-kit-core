const test = require('node:test');
const assert = require('node:assert/strict');

const { MCFormat } = require('../dist/formats/mc/mc-format.service.js');

test('mc format parses mongo operators and populate directive', () => {
  const format = new MCFormat();

  const result = format.parse({
    filterString:
      'status:$eq:active;tags:$in:new,hot;meta:$elemMatch:{\"published\":true};@sort:-createdAt;@populate:profile,orders.items',
    size: 20,
  });

  assert.deepEqual(result.conditions, [
    { field: 'status', operator: 'eq', value: 'active' },
    { field: 'tags', operator: 'in', value: ['new', 'hot'] },
    {
      field: 'meta',
      operator: 'elemMatch',
      value: { published: true },
    },
  ]);
  assert.deepEqual(result.sort, [{ field: 'createdAt', direction: 'desc' }]);
  assert.deepEqual(result.relationLoad, ['profile', 'orders.items']);
  assert.equal(result.limit, 20);
});

test('mc format parses aggregation and group by directives', () => {
  const format = new MCFormat();

  const result = format.parse({
    filterString:
      'status:$eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount;@having:total:$gte:1',
  });

  assert.deepEqual(result.aggregation, {
    groupBy: ['status'],
    metrics: [
      { operator: 'count', alias: 'total' },
      { operator: 'sum', field: 'amount', alias: 'totalAmount' },
    ],
    having: [{ field: 'total', operator: 'gte', value: 1 }],
  });
});
