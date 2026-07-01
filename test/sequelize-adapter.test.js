const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

const {
  SequelizeAdapter,
} = require('../dist/adapters/sequelize/sequelize.adapter.js');

class MockModel {
  constructor(dialect = 'postgres') {
    this.sequelize = {
      getDialect() {
        return dialect;
      },
      escape(value) {
        if (value === null) return 'NULL';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return `'${String(value).replace(/'/g, "''")}'`;
      },
    };
  }
}

test('sequelize adapter supports postgres-specific operators', () => {
  const adapter = new SequelizeAdapter();
  const result = adapter.convert(
    {
      conditions: [
        { field: 'displayName', operator: 'iLike', value: '%john%' },
        { field: 'roles', operator: 'all', value: ['admin'] },
        { field: 'tags', operator: 'any', value: ['new'] },
      ],
    },
    {
      model: new MockModel('postgres'),
      dialect: 'postgres',
    },
  );

  assert.deepEqual(result.where.displayName, { [Op.iLike]: '%john%' });
  assert.deepEqual(result.where.roles, { [Op.contains]: ['admin'] });
  assert.deepEqual(result.where.tags, { [Op.overlap]: ['new'] });
});

test('sequelize adapter emulates ilike for mysql and sqlite', () => {
  const adapter = new SequelizeAdapter();

  const mysqlResult = adapter.convert(
    {
      conditions: [{ field: 'name', operator: 'iLike', value: '%John%' }],
    },
    {
      model: new MockModel('mysql'),
      dialect: 'mysql',
    },
  );

  const sqliteResult = adapter.convert(
    {
      conditions: [{ field: 'name', operator: 'iLike', value: '%John%' }],
    },
    {
      model: new MockModel('sqlite'),
      dialect: 'sqlite',
    },
  );

  assert.equal(mysqlResult.where[Op.and].length, 1);
  assert.equal(sqliteResult.where[Op.and].length, 1);
});

test('sequelize adapter fails fast for unsupported dialect operators', () => {
  const adapter = new SequelizeAdapter();

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'pattern', operator: 'regex', value: '^A' }],
        },
        {
          model: new MockModel('sqlite'),
          dialect: 'sqlite',
        },
      ),
    /not supported by Sequelize adapter for SQL dialect "sqlite"/,
  );

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'tags', operator: 'size', value: 2 }],
        },
        {
          model: new MockModel('sqlite'),
          dialect: 'sqlite',
        },
      ),
    /not supported by Sequelize adapter for SQL dialect "sqlite"/,
  );
});
