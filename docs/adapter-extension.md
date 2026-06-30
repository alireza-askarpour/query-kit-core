# Adapter Extension Guide

## Goal

An adapter converts `NormalizedFilter` into an ORM-specific query representation.

## Minimum requirements

Implement `QueryAdapter`:

```ts
export class MyOrmAdapter implements QueryAdapter<MyOutput, MyOptions> {
  ormName = 'my-orm';

  convert(normalized: NormalizedFilter, options?: MyOptions): MyOutput {
    return {} as MyOutput;
  }
}
```

## Recommended structure

```text
src/adapters/my-orm/
  index.ts
  my-orm.adapter.ts
  my-orm.types.ts
  my-orm.utils.ts
  my-orm-where.builder.ts
```

## Registration

Preferred registration:

```ts
registry.registerAdapterRegistration({
  adapter: new MyOrmAdapter(),
  capabilities: {
    supportsSorting: true,
    supportsPagination: true,
  },
  metadata: {
    family: 'sql',
  },
});
```

## Recommended adapter concerns

- clause building
- field resolution
- include/join resolution
- sorting
- pagination
- case-expression rendering

## Best practices

- keep operator handlers isolated
- do not let one adapter file grow unchecked
- fail fast for unsupported operators
- keep options explicit and typed
