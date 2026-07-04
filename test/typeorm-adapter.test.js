const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TypeOrmAdapter,
} = require('../dist/adapters/typeorm/typeorm.adapter.js');

class MockQueryBuilder {
  constructor() {
    this.whereCalls = [];
    this.orderCalls = [];
    this.takeCalls = [];
    this.skipCalls = [];
    this.selectCalls = [];
    this.addSelectCalls = [];
    this.leftJoinCalls = [];
    this.leftJoinAndSelectCalls = [];
    this.groupByCalls = [];
    this.havingCalls = [];
  }

  andWhere(condition, parameters) {
    this.whereCalls.push({ condition, parameters });
    return this;
  }

  addOrderBy(sort, order) {
    this.orderCalls.push({ sort, order });
    return this;
  }

  take(limit) {
    this.takeCalls.push(limit);
    return this;
  }

  skip(offset) {
    this.skipCalls.push(offset);
    return this;
  }

  select(selection) {
    this.selectCalls.push(selection);
    return this;
  }

  addSelect(selection, aliasName) {
    this.addSelectCalls.push({ selection, aliasName });
    return this;
  }

  leftJoin(path, alias) {
    this.leftJoinCalls.push({ path, alias });
    return this;
  }

  leftJoinAndSelect(path, alias) {
    this.leftJoinAndSelectCalls.push({ path, alias });
    return this;
  }

  groupBy(group) {
    this.groupByCalls.push(group);
    return this;
  }

  addGroupBy(group) {
    this.groupByCalls.push(group);
    return this;
  }

  having(condition, parameters) {
    this.havingCalls.push({ condition, parameters });
    return this;
  }

  andHaving(condition, parameters) {
    this.havingCalls.push({ condition, parameters });
    return this;
  }
}

function createAdapter() {
  return new TypeOrmAdapter();
}

function createBuilder() {
  return new MockQueryBuilder();
}

test('converts full filter set into query builder calls', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  const result = adapter.convert(
    {
      conditions: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'age', operator: 'gt', value: 18 },
        { field: 'price', operator: 'between', value: [10, 20] },
        { field: 'title', operator: 'contains', value: 'pro' },
        { field: 'createdAt', operator: 'date', value: '2024-01-01' },
        { field: 'deletedAt', operator: 'isNull', value: true },
        { field: 'tags', operator: 'any', value: ['new', 'hot'] },
      ],
      sort: [
        { field: 'createdAt', direction: 'desc' },
        { field: 'profile.name', direction: 'asc' },
      ],
      limit: 25,
      page: 2,
      fields: ['id', 'profile.name'],
      customInclude: ['profile', 'orders.items'],
      caseExpressions: [
        {
          outputField: 'priority',
          cases: [
            {
              when: { field: 'amount', operator: 'gte', value: 1000 },
              then: 'high',
            },
            {
              when: { field: 'amount', operator: 'lt', value: 1000 },
              then: 'low',
            },
          ],
          elseValue: 'unknown',
        },
      ],
    },
    {
      queryBuilder,
      rootAlias: 'user',
    },
  );

  assert.equal(result, queryBuilder);
  assert.equal(queryBuilder.whereCalls.length, 7);
  assert.deepEqual(queryBuilder.selectCalls[0], ['user.id', 'profile.name']);
  assert.equal(queryBuilder.addSelectCalls[0].aliasName, 'priority');
  assert.match(
    queryBuilder.addSelectCalls[0].selection,
    /CASE WHEN user\.amount >= 1000/,
  );
  assert.deepEqual(queryBuilder.orderCalls, [
    { sort: 'user.createdAt', order: 'DESC' },
    { sort: 'profile.name', order: 'ASC' },
  ]);
  assert.equal(queryBuilder.takeCalls[0], 25);
  assert.equal(queryBuilder.skipCalls[0], 25);
  assert.deepEqual(queryBuilder.leftJoinAndSelectCalls, [
    { path: 'user.profile', alias: 'user_profile' },
    { path: 'user.orders', alias: 'user_orders' },
    { path: 'user_orders.items', alias: 'user_orders_items' },
  ]);
});

test('uses includeMap and fieldMap when provided', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'displayName', operator: 'iLike', value: '%john%' },
        { field: 'roles', operator: 'all', value: ['admin'] },
      ],
      customInclude: ['profile'],
      limit: 5,
    },
    {
      queryBuilder,
      rootAlias: 'member',
      fieldMap: {
        displayName: 'member.display_name',
        roles: 'member.roles',
      },
      includeMap: {
        profile: {
          path: 'member.profile',
          alias: 'profileAlias',
          select: false,
        },
      },
    },
  );

  assert.equal(
    queryBuilder.whereCalls[0].condition,
    'member.display_name ILIKE :displayName_iLike',
  );
  assert.deepEqual(queryBuilder.whereCalls[1], {
    condition: 'member.roles @> :roles_all',
    parameters: { roles_all: ['admin'] },
  });
  assert.deepEqual(queryBuilder.leftJoinCalls, [
    { path: 'member.profile', alias: 'profileAlias' },
  ]);
  assert.equal(queryBuilder.leftJoinAndSelectCalls.length, 0);
  assert.equal(queryBuilder.takeCalls[0], 5);
  assert.equal(queryBuilder.skipCalls[0], 0);
});

test('supports array and null operators', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'status', operator: 'in', value: ['active', 'pending'] },
        { field: 'role', operator: 'notIn', value: ['guest'] },
        { field: 'tags', operator: 'size', value: 3 },
        { field: 'deletedAt', operator: 'isNotNull', value: true },
        { field: 'profile', operator: 'exists', value: true },
        { field: 'orders', operator: 'notExists', value: true },
        { field: 'pattern', operator: 'regex', value: '^[A-Z]+$' },
      ],
    },
    { queryBuilder },
  );

  assert.deepEqual(queryBuilder.whereCalls[0], {
    condition: 'entity.status IN (:...status_in)',
    parameters: { status_in: ['active', 'pending'] },
  });
  assert.deepEqual(queryBuilder.whereCalls[1], {
    condition: 'entity.role NOT IN (:...role_notIn)',
    parameters: { role_notIn: ['guest'] },
  });
  assert.deepEqual(queryBuilder.whereCalls[2], {
    condition: 'cardinality(entity.tags) = :tags_size',
    parameters: { tags_size: 3 },
  });
  assert.equal(queryBuilder.whereCalls[3].condition, 'entity.deletedAt IS NOT NULL');
  assert.equal(queryBuilder.whereCalls[4].condition, 'entity.profile IS NOT NULL');
  assert.equal(queryBuilder.whereCalls[5].condition, 'entity.orders IS NULL');
  assert.equal(queryBuilder.whereCalls[6].condition, 'entity.pattern ~ :pattern_regex');
});

test('supports month and day operators plus offset override', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'createdAt', operator: 'month', value: '2024-05' },
        { field: 'createdAt', operator: 'day', value: 15 },
      ],
      limit: 1000,
      offset: 7,
    },
    {
      queryBuilder,
      maxLimit: 50,
    },
  );

  assert.deepEqual(queryBuilder.whereCalls[0], {
    condition: "TO_CHAR(entity.createdAt, 'YYYY-MM') = :createdAt_month",
    parameters: { createdAt_month: '2024-05' },
  });
  assert.deepEqual(queryBuilder.whereCalls[1], {
    condition: 'EXTRACT(DAY FROM entity.createdAt) = :createdAt_day',
    parameters: { createdAt_day: 15 },
  });
  assert.equal(queryBuilder.takeCalls[0], 50);
  assert.equal(queryBuilder.skipCalls[0], 7);
});

test('supports logical groups and negation in a single where clause', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

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
    { queryBuilder, rootAlias: 'user' },
  );

  assert.equal(queryBuilder.whereCalls.length, 1);
  assert.match(queryBuilder.whereCalls[0].condition, /\)\s+AND\s+\(NOT/);
  assert.deepEqual(queryBuilder.whereCalls[0].parameters, {
    status_eq_0_0: 'active',
    status_eq_0_1: 'pending',
  });
});

test('covers remaining comparison and string operators plus year branch', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'score', operator: 'neq', value: 0 },
        { field: 'score', operator: 'gte', value: 5 },
        { field: 'score', operator: 'lt', value: 100 },
        { field: 'score', operator: 'lte', value: 101 },
        { field: 'name', operator: 'like', value: '%john%' },
        { field: 'name', operator: 'notLike', value: '%bot%' },
        { field: 'name', operator: 'startsWith', value: 'J' },
        { field: 'name', operator: 'endsWith', value: 'n' },
        { field: 'createdAt', operator: 'year', value: 2024 },
        { field: 'deletedAt', operator: 'isNull', value: false },
        { field: 'deletedAt', operator: 'isNotNull', value: false },
        { field: 'profile', operator: 'exists', value: false },
        { field: 'orders', operator: 'notExists', value: false },
      ],
    },
    { queryBuilder },
  );

  assert.equal(queryBuilder.whereCalls[0].condition, 'entity.score <> :score_neq');
  assert.equal(queryBuilder.whereCalls[1].condition, 'entity.score >= :score_gte');
  assert.equal(queryBuilder.whereCalls[2].condition, 'entity.score < :score_lt');
  assert.equal(queryBuilder.whereCalls[3].condition, 'entity.score <= :score_lte');
  assert.equal(queryBuilder.whereCalls[4].condition, 'entity.name LIKE :name_like');
  assert.equal(
    queryBuilder.whereCalls[5].condition,
    'entity.name NOT LIKE :name_notLike',
  );
  assert.deepEqual(queryBuilder.whereCalls[6], {
    condition: 'entity.name LIKE :name_startsWith',
    parameters: { name_startsWith: 'J%' },
  });
  assert.deepEqual(queryBuilder.whereCalls[7], {
    condition: 'entity.name LIKE :name_endsWith',
    parameters: { name_endsWith: '%n' },
  });
  assert.deepEqual(queryBuilder.whereCalls[8], {
    condition: 'EXTRACT(YEAR FROM entity.createdAt) = :createdAt_year',
    parameters: { createdAt_year: 2024 },
  });
  assert.equal(queryBuilder.whereCalls[9].condition, 'entity.deletedAt IS NOT NULL');
  assert.equal(queryBuilder.whereCalls[10].condition, 'entity.deletedAt IS NULL');
  assert.equal(queryBuilder.whereCalls[11].condition, 'entity.profile IS NULL');
  assert.equal(queryBuilder.whereCalls[12].condition, 'entity.orders IS NOT NULL');
});

test('uses default join alias and complex CASE replacements', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [],
      customInclude: ['stats'],
      caseExpressions: [
        {
          outputField: 'bucket',
          cases: [
            {
              when: { field: 'status', operator: 'in', value: ['active', 'pending'] },
              then: true,
            },
            {
              when: { field: 'deletedAt', operator: 'isNull', value: true },
              then: 1,
            },
          ],
          elseValue: null,
        },
      ],
    },
    {
      queryBuilder,
      includeMap: {
        stats: {
          path: 'entity.stats',
        },
      },
    },
  );

  assert.deepEqual(queryBuilder.leftJoinAndSelectCalls, [
    { path: 'entity.stats', alias: 'entity_stats' },
  ]);
  assert.match(
    queryBuilder.addSelectCalls[0].selection,
    /WHEN entity\.status IN \('active', 'pending'\) THEN true/,
  );
  assert.match(
    queryBuilder.addSelectCalls[0].selection,
    /WHEN entity\.deletedAt IS NULL THEN 1 ELSE NULL END/,
  );
});

test('deduplicates mapped include aliases', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [],
      customInclude: ['profile', 'profile'],
    },
    {
      queryBuilder,
      includeMap: {
        profile: {
          path: 'entity.profile',
          alias: 'profile_alias',
        },
      },
    },
  );

  assert.equal(queryBuilder.leftJoinAndSelectCalls.length, 1);
});

test('throws on unsupported operator in where builder', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'score', operator: 'sum', value: 1 }],
        },
        { queryBuilder },
      ),
    /not supported in TypeORM adapter/,
  );
});

test('throws on malformed between and array clauses', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'price', operator: 'between', value: [10] }],
        },
        { queryBuilder },
      ),
    /exactly two values/,
  );

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'status', operator: 'in', value: [] }],
        },
        { queryBuilder },
      ),
    /non-empty array/,
  );
});

test('typeorm adapter emits mysql-specific date expressions', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'createdAt', operator: 'year', value: 2024 },
        { field: 'createdAt', operator: 'month', value: '2024-05' },
        { field: 'createdAt', operator: 'day', value: 15 },
      ],
    },
    { queryBuilder, dialect: 'mysql' },
  );

  assert.deepEqual(queryBuilder.whereCalls[0], {
    condition: 'YEAR(entity.createdAt) = :createdAt_year',
    parameters: { createdAt_year: 2024 },
  });
  assert.deepEqual(queryBuilder.whereCalls[1], {
    condition: "DATE_FORMAT(entity.createdAt, '%Y-%m') = :createdAt_month",
    parameters: { createdAt_month: '2024-05' },
  });
  assert.deepEqual(queryBuilder.whereCalls[2], {
    condition: 'DAY(entity.createdAt) = :createdAt_day',
    parameters: { createdAt_day: 15 },
  });
});

test('typeorm adapter emits sqlite-specific date expressions', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [
        { field: 'createdAt', operator: 'year', value: 2024 },
        { field: 'createdAt', operator: 'month', value: '2024-05' },
        { field: 'createdAt', operator: 'day', value: 15 },
      ],
    },
    { queryBuilder, dialect: 'sqlite' },
  );

  assert.deepEqual(queryBuilder.whereCalls[0], {
    condition: "CAST(strftime('%Y', entity.createdAt) AS INTEGER) = :createdAt_year",
    parameters: { createdAt_year: 2024 },
  });
  assert.deepEqual(queryBuilder.whereCalls[1], {
    condition: "strftime('%Y-%m', entity.createdAt) = :createdAt_month",
    parameters: { createdAt_month: '2024-05' },
  });
  assert.deepEqual(queryBuilder.whereCalls[2], {
    condition: "CAST(strftime('%d', entity.createdAt) AS INTEGER) = :createdAt_day",
    parameters: { createdAt_day: 15 },
  });
});

test('typeorm adapter fails fast for unsupported dialect operators', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'tags', operator: 'any', value: ['new'] }],
        },
        { queryBuilder, dialect: 'mysql' },
      ),
    /not supported by TypeORM adapter for SQL dialect "mysql"/,
  );

  assert.throws(
    () =>
      adapter.convert(
        {
          conditions: [{ field: 'pattern', operator: 'regex', value: '^A' }],
        },
        { queryBuilder, dialect: 'sqlite' },
      ),
    /not supported by TypeORM adapter for SQL dialect "sqlite"/,
  );
});

test('typeorm adapter applies aggregation selects and grouping', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      conditions: [{ field: 'status', operator: 'eq', value: 'active' }],
      aggregation: {
        groupBy: ['status'],
        metrics: [
          { operator: 'count', alias: 'total' },
          { operator: 'sum', field: 'amount', alias: 'totalAmount' },
          { operator: 'avg', field: 'score', alias: 'avgScore' },
        ],
      },
    },
    {
      queryBuilder,
      rootAlias: 'user',
    },
  );

  assert.deepEqual(queryBuilder.selectCalls[0], ['user.status']);
  assert.deepEqual(queryBuilder.groupByCalls, ['user.status']);
  assert.deepEqual(queryBuilder.addSelectCalls, [
    { selection: 'COUNT(*)', aliasName: 'total' },
    { selection: 'SUM(user.amount)', aliasName: 'totalAmount' },
    { selection: 'AVG(user.score)', aliasName: 'avgScore' },
  ]);
});

test('typeorm adapter applies group by without requiring metrics', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      aggregation: {
        groupBy: ['status'],
        metrics: [],
      },
    },
    {
      queryBuilder,
      rootAlias: 'user',
    },
  );

  assert.deepEqual(queryBuilder.selectCalls[0], ['user.status']);
  assert.deepEqual(queryBuilder.groupByCalls, ['user.status']);
});

test('typeorm adapter builds having using aggregation alias expression', () => {
  const adapter = createAdapter();
  const queryBuilder = createBuilder();

  adapter.convert(
    {
      aggregation: {
        groupBy: ['status'],
        metrics: [{ operator: 'sum', field: 'amount', alias: 'totalAmount' }],
        having: [{ field: 'totalAmount', operator: 'gt', value: 100 }],
      },
    },
    {
      queryBuilder,
      rootAlias: 'user',
    },
  );

  assert.deepEqual(queryBuilder.havingCalls[0], {
    condition: 'SUM(user.amount) > 100',
    parameters: undefined,
  });
});
