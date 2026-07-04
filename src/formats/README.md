# Formats

Formats define how a query syntax is interpreted.

## Responsibilities

- parse a query string into `FilterIR`
- optionally validate the syntax and values
- normalize operators and directive semantics
- declare explicit capability metadata for processor preflight checks

## Current formats

- `sc`
- `mc`

## Recommended per-format structure

```text
src/formats/<format-name>/
  index.ts
  <format-name>-format.service.ts
  <format-name>-format.validator.ts
  <format-name>-format.constants.ts
  <format-name>-format.parser.ts
  <format-name>-format.schema.ts
  <format-name>-format.value.ts
```
