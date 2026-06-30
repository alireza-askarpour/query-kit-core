import { Provider, Type } from '@nestjs/common';
import { AdapterRegistration, QueryAdapter } from '../core';
import { SequelizeAdapter } from './sequelize';
import { TypeOrmAdapter } from './typeorm';

export const FILTER_ADAPTER_REGISTRATIONS = 'FILTER_ADAPTER_REGISTRATIONS';

export const DEFAULT_ADAPTER_CLASSES: Type<QueryAdapter>[] = [
  SequelizeAdapter,
  TypeOrmAdapter,
];

export const DEFAULT_ADAPTER_PROVIDERS: Provider[] = [
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
