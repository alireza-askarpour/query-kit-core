import { Injectable, NotFoundException } from '@nestjs/common';
import { AdapterBundle } from '../contracts/adapter-registration.interface';
import { FilterMetadata } from '../contracts/filter-capabilities.interface';
import { FilterFormat } from '../contracts/filter-format.interface';
import { FilterFormatValidator } from '../contracts/filter-format-validator.interface';
import { QueryAdapter } from '../contracts/query-adapter.interface';

export interface FilterFormatRegistration {
  format: FilterFormat;
  validator?: FilterFormatValidator;
  capabilities?: FilterFormat['capabilities'];
  metadata?: FilterMetadata;
}

export interface AdapterRegistration<TAdapter extends QueryAdapter = QueryAdapter>
  extends AdapterBundle<TAdapter> {}

@Injectable()
export class FilterRegistry {
  private readonly formats = new Map<string, FilterFormat>();
  private readonly formatRegistrations = new Map<string, FilterFormatRegistration>();
  private readonly validators = new Map<string, FilterFormatValidator>();
  private readonly adapters = new Map<string, QueryAdapter>();
  private readonly adapterRegistrations = new Map<string, AdapterRegistration>();

  registerFormat(format: FilterFormat): void {
    this.formats.set(format.name, format);
  }

  registerFormatRegistration(registration: FilterFormatRegistration): void {
    this.registerFormat(registration.format);
    this.formatRegistrations.set(registration.format.name, {
      ...registration,
      capabilities: registration.capabilities ?? registration.format.capabilities,
      metadata: registration.metadata ?? registration.format.metadata,
    });

    if (registration.validator) {
      this.registerValidator(registration.validator);
    }
  }

  getFormat(name: string): FilterFormat {
    return this.requireRegistration(this.formats, name, 'Format');
  }

  getFormatRegistration(name: string): FilterFormatRegistration {
    return this.requireRegistration(this.formatRegistrations, name, 'Format');
  }

  registerValidator(validator: FilterFormatValidator): void {
    this.validators.set(validator.formatName, validator);
  }

  getValidator<TSchema = unknown>(
    formatName: string,
  ): FilterFormatValidator<TSchema> | undefined {
    return this.validators.get(formatName) as FilterFormatValidator<TSchema> | undefined;
  }

  registerAdapter(adapter: QueryAdapter): void {
    this.registerAdapterRegistration({ adapter });
  }

  registerAdapterRegistration<TAdapter extends QueryAdapter>(
    registration: AdapterRegistration<TAdapter>,
  ): void {
    this.adapters.set(registration.adapter.ormName, registration.adapter);
    this.adapterRegistrations.set(registration.adapter.ormName, {
      ...registration,
      capabilities: registration.capabilities ?? registration.adapter.capabilities,
      metadata: registration.metadata ?? registration.adapter.metadata,
    });
  }

  getAdapter<TQueryBuilder = unknown, TOptions = unknown>(
    ormName: string,
  ): QueryAdapter<TQueryBuilder, TOptions> {
    return this.requireRegistration(
      this.adapters,
      ormName,
      'Adapter',
    ) as QueryAdapter<TQueryBuilder, TOptions>;
  }

  getAdapterRegistration<TAdapter extends QueryAdapter = QueryAdapter>(
    ormName: string,
  ): AdapterRegistration<TAdapter> {
    return this.requireRegistration(
      this.adapterRegistrations,
      ormName,
      'Adapter',
    ) as AdapterRegistration<TAdapter>;
  }

  private requireRegistration<TValue>(
    collection: Map<string, TValue>,
    key: string,
    label: string,
  ): TValue {
    const value = collection.get(key);

    if (!value) {
      throw new NotFoundException(`${label} "${key}" not found`);
    }

    return value;
  }
}
