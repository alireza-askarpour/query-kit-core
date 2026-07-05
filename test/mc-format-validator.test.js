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

test('mc validator enforces field whitelist and blacklist', () => {
  const validator = new MCFormatValidator({
    fieldWhitelist: ['status', 'profile'],
    fieldBlacklist: ['profile.secret'],
  });

  const result = validator.validate(
    'status:$eq:active;profile.name:$eq:john;profile.secret:$eq:x;price:$eq:10',
  );

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((item) => item.code === 'FIELD_BLACKLISTED'));
  assert.ok(result.errors.some((item) => item.code === 'FIELD_NOT_WHITELISTED'));
});

test('mc validator applies per-field transformer and custom hook', () => {
  const validator = new MCFormatValidator({
    customValidator: ({ field, value }) => {
      if (field === 'status' && value === 'ACTIVE') {
        return { code: 'STATUS_NORMALIZED', message: 'status normalized', level: 'warning' };
      }
    },
  });

  const result = validator.validate('status:$eq:active', {
    status: {
      type: 'string',
      enum: ['ACTIVE'],
      transform: ({ value }) => String(value).toUpperCase(),
    },
  });

  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedConditions[0].value, 'ACTIVE');
  assert.ok(result.warnings.some((item) => item.code === 'STATUS_NORMALIZED'));
});

test('mc validator enforces role-based field access', () => {
  const validator = new MCFormatValidator({
    roleFieldAccess: {
      user: {
        allowFields: ['status'],
      },
    },
  });

  const result = validator.validate(
    'status:$eq:active;salary:$eq:1000',
    {
      salary: { type: 'number', access: { allowRoles: ['admin'] } },
      status: { type: 'string' },
    },
    { role: 'user' },
  );

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((item) => item.field === 'salary'));
  assert.ok(result.errors.some((item) => item.code === 'FIELD_ROLE_DENIED'));
});
