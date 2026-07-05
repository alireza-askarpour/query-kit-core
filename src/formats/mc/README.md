# MC Format

The `MC` format is a MongoDB-oriented query syntax for `Mongoose` and document-style adapters.

## Syntax

Basic condition:

```text
field:$operator:value
```

Examples:

```text
status:$eq:active
price:$gte:100
tags:$in:new,hot
meta:$elemMatch:{"published":true}
```

## Directives

- `@sort`
- `@limit`
- `@page`
- `@offset`
- `@fields`
- `@populate`
- `@groupBy`
- `@aggregate`
- `@having`

Example:

```text
status:$eq:active;@sort:-createdAt;@populate:profile,orders.items
status:$eq:active;@groupBy:status;@aggregate:count(*):total,sum(amount):totalAmount;@having:totalAmount:$gte:100
```

## Validation

`MCFormatValidator` validates:

- allowed operators per field type
- nested field rules
- JSON object payloads for `elemMatch`
- field whitelist / blacklist
- per-field transformers
- per-field and global validator hooks
- role-based field access
- dangerous payload patterns such as `$where`
