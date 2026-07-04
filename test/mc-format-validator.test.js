const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MCFormatValidator,
} = require('../dist/formats/mc/mc-format.validator.js');

test('mc validator validates and sanitizes valid conditions', () => {
  const validator = new MCFormatValidator();

  const result = validator.validate(
    'status:$eq:active;age:$gte:18;tags:$in:new,hot;meta:$elemMatch:{"published":true}',
    {
      status: { type: 'string' },
      age: { type: 'number', min: 0 },
      tags: { type: 'array' },
      meta: { type: 'object', allowedOperators: ['elemMatch'] },
    },
  );

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.sanitizedConditions[1], {
    field: 'age',
    operator: 'gte',
    rawValue: '18',
    value: 18,
  });
});

test('mc validator blocks object operators by default', () => {
  const validator = new MCFormatValidator();

  const result = validator.validate(
    'meta:$elemMatch:{"$gt":5}',
    {
      meta: { type: 'object', allowedOperators: ['elemMatch'] },
    },
  );

  assert.equal(result.isValid, false);
  assert.equal(result.errors[0].code, 'VALUE_PARSE_ERROR');
});

test('mc validator rejects unsupported operator for field type', () => {
  const validator = new MCFormatValidator();

  const result = validator.validate(
    'status:$gte:active',
    {
      status: { type: 'string' },
    },
  );

  assert.equal(result.isValid, false);
  assert.equal(result.errors[0].code, 'OPERATOR_NOT_ALLOWED_FOR_FIELD');
});

test('mc validator validates aggregation directives and having aliases', () => {
  const validator = new MCFormatValidator();

  const result = validator.validate(
    'status:$eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount;@having:total:$gte:1',
    {
      status: { type: 'string' },
      amount: { type: 'number' },
    },
  );

  assert.equal(result.isValid, true);
});
