import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { FilterRegistry } from './filter-registry.service';
import {
  FilterCapabilities,
  FilterProcessRequest,
  FilterRuntimeOptions,
  Query,
} from '../contracts';
import { FilterIR, getCapabilityRequirements } from '../types';
import { QueryAdapter } from '../contracts/query-adapter.interface';

@Injectable()
export class FilterProcessor {
  constructor(
    private readonly registry: FilterRegistry,
    @Optional()
    @Inject('FILTER_OPTIONS')
    private readonly runtimeOptions: FilterRuntimeOptions = {},
  ) {}

  process<TQueryResult, TOptions = unknown>(
    query: string | Query,
    formatName: string,
    ormName: string,
    options?: TOptions,
  ): ReturnType<QueryAdapter<TQueryResult>['convert']> {
    return this.processWith<TQueryResult, TOptions>({
      query,
      formatName,
      ormName,
      adapterOptions: options,
    });
  }

  processWith<TQueryResult, TAdapterOptions = unknown, TSchema = unknown>(
    request: FilterProcessRequest<TAdapterOptions, TSchema>,
  ): ReturnType<QueryAdapter<TQueryResult, TAdapterOptions>['convert']> {
    const formatName = request.formatName ?? this.runtimeOptions.defaultFormat;
    const ormName = request.ormName ?? this.runtimeOptions.defaultOrm;

    if (!formatName) {
      throw new BadRequestException(
        'Filter format name is required when no default format is configured',
      );
    }

    if (!ormName) {
      throw new BadRequestException(
        'Adapter name is required when no default adapter is configured',
      );
    }

    const normalizedQuery = this.normalizeQuery(request.query);
    this.validateQueryIfNeeded(
      normalizedQuery.filterString,
      formatName,
      request.pipeline,
    );

    const formatRegistration = this.registry.getFormatRegistration(formatName);
    const format = formatRegistration.format;
    const normalized = format.parse(normalizedQuery);
    this.validateCapabilities(
      'Format',
      format.name,
      formatRegistration.capabilities,
      normalized,
    );

    const adapter = this.registry.getAdapter<TQueryResult, TAdapterOptions>(
      ormName,
    );
    const adapterRegistration = this.registry.getAdapterRegistration(ormName);
    this.validateCapabilities(
      'Adapter',
      adapter.ormName,
      adapterRegistration.capabilities,
      normalized,
    );

    return adapter.convert(normalized, request.adapterOptions);
  }

  private normalizeQuery(query: string | Query): Query {
    return typeof query === 'string' ? { filterString: query } : query;
  }

  private validateQueryIfNeeded<TSchema>(
    queryString: string,
    formatName: string,
    pipeline?: FilterProcessRequest<unknown, TSchema>['pipeline'],
  ): void {
    const shouldValidate =
      pipeline?.validate ?? this.runtimeOptions.enableValidation ?? false;

    if (!shouldValidate) {
      return;
    }

    const validator = this.registry.getValidator<TSchema>(formatName);

    if (!validator) {
      return;
    }

    const result = validator.validate(queryString, pipeline?.schema);

    if (!result.isValid) {
      throw new BadRequestException({
        message: `Filter validation failed for format "${formatName}"`,
        errors: result.errors,
        warnings: result.warnings,
      });
    }
  }

  private validateCapabilities(
    targetType: 'Format' | 'Adapter',
    targetName: string,
    capabilities: FilterCapabilities | undefined,
    normalized: FilterIR,
  ): void {
    if (!capabilities) {
      return;
    }

    const requirements = getCapabilityRequirements(normalized);
    const missingFeatures: string[] = [];

    if (requirements.requiresRegex && capabilities.supportsRegex === false) {
      missingFeatures.push('regex operators');
    }

    if (
      requirements.requiresArrayOperators &&
      capabilities.supportsArrayOperators === false
    ) {
      missingFeatures.push('array operators');
    }

    if (
      requirements.requiresCaseExpressions &&
      capabilities.supportsCaseExpressions === false
    ) {
      missingFeatures.push('CASE expressions');
    }

    if (
      requirements.requiresAggregations &&
      capabilities.supportsAggregations === false
    ) {
      missingFeatures.push('aggregations');
    }

    if (missingFeatures.length === 0) {
      return;
    }

    throw new BadRequestException(
      `${targetType} "${targetName}" does not support: ${missingFeatures.join(', ')}`,
    );
  }
}
