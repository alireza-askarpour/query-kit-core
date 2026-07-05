const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCFormatValidator,
} = require('../dist/formats/sc/sc-format.validator.js');

test('sc validator enforces field whitelist and blacklist', () => {
  const validator = new SCFormatValidator({
    fieldWhitelist: ['status', 'profile'],
    fieldBlacklist: ['status.internal'],
  });

  const result = validator.validate(
    'status:eq:active;profile.name:eq:john;status.internal:eq:true;price:eq:10',
  );

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((item) => item.code === 'FIELD_BLACKLISTED'));
  assert.ok(result.errors.some((item) => item.code === 'FIELD_NOT_WHITELISTED'));
});

test('sc validator applies per-field transformer before schema checks', () => {
  const validator = new SCFormatValidator();

  const result = validator.validate('status:eq:active', {
    status: {
      type: 'string',
      enum: ['ACTIVE'],
      transform: ({ value }) => String(value).toUpperCase(),
    },
  });

  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedConditions[0].value, 'ACTIVE');
});

test('sc validator executes per-field and custom validator hooks', () => {
  const validator = new SCFormatValidator({
    customValidator: ({ field, value }) => {
      if (field === 'score' && value > 90) {
        return { code: 'GLOBAL_SCORE_WARNING', message: 'score is unusually high', level: 'warning' };
      }
    },
  });

  const result = validator.validate('score:gte:95', {
    score: {
      type: 'number',
      validate: ({ value }) => {
        if (value > 100) {
          return { code: 'FIELD_SCORE_LIMIT', message: 'score cannot exceed 100' };
        }
      },
    },
  });

  assert.equal(result.isValid, true);
  assert.ok(result.warnings.some((item) => item.code === 'GLOBAL_SCORE_WARNING'));
});

test('sc validator enforces role-based field access', () => {
  const validator = new SCFormatValidator({
    roleFieldAccess: {
      user: {
        allowFields: ['status'],
      },
    },
  });

  const result = validator.validate(
    'status:eq:active;salary:eq:1000',
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
