# Nest Integration

This folder contains the NestJS integration layer.

## Purpose

The library core is framework-light, but Nest integration is provided through `FilterModule`.

## `FilterModule`

The module is responsible for:

- registering formats
- registering validators
- registering default adapter bundles
- exposing the processor and registry to Nest consumers

## Current default registrations

- `SCFormat`
- `SCFormatValidator`
- `MCFormat`
- `MCFormatValidator`
- `MongooseAdapter`
- `SequelizeAdapter`
- `TypeOrmAdapter`

## Runtime options

Supported runtime options:

- `defaultFormat`
- `defaultOrm`
- `enableValidation`
- `validationOptions`
- `mcValidationOptions`
