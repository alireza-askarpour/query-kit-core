import {
  DynamicModule,
  Inject,
  Module,
  OnApplicationBootstrap,
  Provider,
} from '@nestjs/common';
import {
  DEFAULT_ADAPTER_EXPORTS,
  DEFAULT_ADAPTER_PROVIDERS,
  FILTER_ADAPTER_REGISTRATIONS,
} from '../adapters';
import { AdapterRegistration, FilterRuntimeOptions, QueryAdapter } from '../core';
import { FilterProcessor } from '../core/services/filter-processor.service';
import {
  FilterFormatRegistration,
  FilterRegistry,
} from '../core/services/filter-registry.service';
import {
  DEFAULT_FORMAT_EXPORTS,
  DEFAULT_FORMAT_PROVIDERS,
  FILTER_FORMAT_REGISTRATIONS,
} from '../formats';
import { MongoValidationOptions } from '../formats/mc';
import { ValidationOptions } from '../formats/sc';

export interface FilterModuleOptions extends FilterRuntimeOptions {
  validationOptions?: ValidationOptions;
  mcValidationOptions?: MongoValidationOptions;
}

@Module({})
export class FilterModule implements OnApplicationBootstrap {
  constructor(
    @Inject(FilterRegistry) private readonly filterRegistry: FilterRegistry,
    @Inject(FILTER_FORMAT_REGISTRATIONS)
    private readonly formatRegistrations: FilterFormatRegistration[],
    @Inject(FILTER_ADAPTER_REGISTRATIONS)
    private readonly adapterRegistrations: AdapterRegistration<QueryAdapter>[],
  ) {}

  static forRoot(options: FilterModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      FilterRegistry,
      FilterProcessor,
      ...DEFAULT_FORMAT_PROVIDERS,
      ...DEFAULT_ADAPTER_PROVIDERS,
      {
        provide: 'FILTER_OPTIONS',
        useValue: options,
      },
      {
        provide: 'SC_FORMAT_VALIDATION_OPTIONS',
        useValue: options.validationOptions ?? {},
      },
      {
        provide: 'MC_FORMAT_VALIDATION_OPTIONS',
        useValue: options.mcValidationOptions ?? {},
      },
    ];

    return {
      module: FilterModule,
      global: Boolean(options.defaultFormat),
      providers,
      exports: [
        FilterProcessor,
        FilterRegistry,
        ...DEFAULT_FORMAT_EXPORTS,
        ...DEFAULT_ADAPTER_EXPORTS,
      ],
    };
  }

  onApplicationBootstrap(): void {
    this.formatRegistrations.forEach((registration) => {
      this.filterRegistry.registerFormatRegistration(registration);
    });
    this.adapterRegistrations.forEach((registration) => {
      this.filterRegistry.registerAdapterRegistration(registration);
    });
  }
}
