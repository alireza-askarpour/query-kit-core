import {
  DynamicModule,
  Inject,
  Module,
  OnApplicationBootstrap,
  Provider,
} from '@nestjs/common';
import {
  DEFAULT_ADAPTER_PROVIDERS,
  FILTER_ADAPTER_REGISTRATIONS,
} from '../adapters';
import { AdapterRegistration, FilterRuntimeOptions, QueryAdapter } from '../core';
import { FilterProcessor } from '../core/services/filter-processor.service';
import { FilterRegistry } from '../core/services/filter-registry.service';
import { SCFormat, SCFormatValidator, ValidationOptions } from '../formats/sc';

export interface FilterModuleOptions extends FilterRuntimeOptions {
  validationOptions?: ValidationOptions;
}

@Module({})
export class FilterModule implements OnApplicationBootstrap {
  constructor(
    @Inject(FilterRegistry) private readonly filterRegistry: FilterRegistry,
    @Inject(SCFormat) private readonly scFormat: SCFormat,
    @Inject(SCFormatValidator)
    private readonly scFormatValidator: SCFormatValidator,
    @Inject(FILTER_ADAPTER_REGISTRATIONS)
    private readonly adapterRegistrations: AdapterRegistration<QueryAdapter>[],
  ) {}

  static forRoot(options: FilterModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      FilterRegistry,
      FilterProcessor,
      SCFormat,
      ...DEFAULT_ADAPTER_PROVIDERS,
      {
        provide: 'FILTER_OPTIONS',
        useValue: options,
      },
      {
        provide: 'SC_FORMAT_VALIDATION_OPTIONS',
        useValue: options.validationOptions ?? {},
      },
      SCFormatValidator,
    ];

    return {
      module: FilterModule,
      global: Boolean(options.defaultFormat),
      providers,
      exports: [
        FilterProcessor,
        FilterRegistry,
        SCFormat,
        ...DEFAULT_ADAPTER_PROVIDERS,
        SCFormatValidator,
      ],
    };
  }

  onApplicationBootstrap(): void {
    this.filterRegistry.registerFormatRegistration({
      format: this.scFormat,
      validator: this.scFormatValidator,
    });
    this.adapterRegistrations.forEach((registration) => {
      this.filterRegistry.registerAdapterRegistration(registration);
    });
  }
}
