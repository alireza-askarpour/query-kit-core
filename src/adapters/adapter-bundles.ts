import type { Provider, Type } from '@nestjs/common';
import type { AdapterRegistration, QueryAdapter } from '../core';
import { MongooseAdapter } from './mongoose';
import { SequelizeAdapter } from './sequelize';
import { TypeOrmAdapter } from './typeorm';

export const FILTER_ADAPTER_REGISTRATIONS = 'FILTER_ADAPTER_REGISTRATIONS';

export const DEFAULT_ADAPTER_CLASSES: Type<QueryAdapter>[] = [
  MongooseAdapter,
  SequelizeAdapter,
  TypeOrmAdapter,
];

export const DEFAULT_ADAPTER_EXPORTS: Array<Type<QueryAdapter> | string> = [
  MongooseAdapter,
  SequelizeAdapter,
  TypeOrmAdapter,
  FILTER_ADAPTER_REGISTRATIONS,
];

export const DEFAULT_ADAPTER_PROVIDERS: Provider[] = [
  MongooseAdapter,
  SequelizeAdapter,
  TypeOrmAdapter,
  {
    provide: FILTER_ADAPTER_REGISTRATIONS,
    inject: DEFAULT_ADAPTER_CLASSES,
    useFactory: (
      ...adapters: QueryAdapter[]
    ): AdapterRegistration<QueryAdapter>[] =>
      adapters.map((adapter) => ({
        adapter,
      })),
  },
];
