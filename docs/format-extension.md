# Format Extension Guide

## Goal

A format should define how a specific query syntax is parsed and optionally validated.

## Minimum requirements

Implement a new `FilterFormat`:

```ts
export class MyFormat implements FilterFormat {
  name = 'my-format';

  parse(query: Query): NormalizedFilter {
    return {
      conditions: [],
    };
  }
}
```

## Optional validator

If the format needs validation, implement `FilterFormatValidator` and attach it during registration.

## Recommended structure

```text
src/formats/my-format/
  index.ts
  my-format.service.ts
  my-format.validator.ts
  my-format.constants.ts
  my-format.parser.ts
  my-format.schema.ts
  my-format.value.ts
```

## Registration

Register format and validator together:

```ts
registry.registerFormatRegistration({
  format: new MyFormat(),
  validator: new MyFormatValidator(),
});
```

## Best practices

- keep parsing separate from validation
- keep schema rules separate from value parsing
- avoid putting all rules in one large class
- keep normalized output consistent with `NormalizedFilter`
