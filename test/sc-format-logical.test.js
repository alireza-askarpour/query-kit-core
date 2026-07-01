const test = require('node:test');
const assert = require('node:assert/strict');

const { SCFormat } = require('../dist/formats/sc/sc-format.service.js');
const {
  SCFormatValidator,
} = require('../dist/formats/sc/sc-format.validator.js');

test('sc format builds logical expression tree with grouping and negation', () => {
  const format = new SCFormat();

  const result = format.parse({
    filterString:
      '(status:eq:active|status:eq:pending);!deletedAt:exists:true;@limit:10',
  });

  assert.equal(result.conditions.length, 3);
  assert.equal(result.limit, 10);
  assert.equal(result.logicalExpression.kind, 'group');
  assert.equal(result.logicalExpression.operator, 'and');
  assert.equal(result.logicalExpression.children[0].kind, 'group');
  assert.equal(result.logicalExpression.children[0].operator, 'or');
  assert.equal(result.logicalExpression.children[1].kind, 'not');
});

test('sc format validator accepts nested logical groups', () => {
  const validator = new SCFormatValidator();

  const result = validator.validate(
    '(status:eq:active|status:eq:pending);price:gt:100',
    {
      status: { type: 'string' },
      price: { type: 'number' },
    },
  );

  assert.equal(result.isValid, true);
  assert.equal(result.sanitizedConditions.length, 3);
});

test('sc format validator rejects unbalanced groups', () => {
  const validator = new SCFormatValidator();

  const result = validator.validate('(status:eq:active|price:gt:100', {
    status: { type: 'string' },
    price: { type: 'number' },
  });

  assert.equal(result.isValid, false);
  assert.equal(result.errors[0].code, 'PARSE_ERROR');
});
