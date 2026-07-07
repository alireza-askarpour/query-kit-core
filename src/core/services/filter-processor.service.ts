import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { FilterRegistry } from './filter-registry.service';
import {
  AdapterStrategyDiagnostic,
  AppliedValidationRuleDiagnostic,
  FilterAuditResult,
  FilterAuditError,
  FilterCapabilities,
  FilterPolicyContext,
  FilterValidationIssue,
  FilterProcessRequest,
  FilterRuntimeOptions,
  Query,
} from '../contracts';
import {
  FilterIR,
  createLogicalGroupNode,
  createPredicateNode,
  evaluateFilterPolicy,
  getCapabilityRequirements,
  getPredicates,
  getProjectionFields,
  getRelations,
  getSorting,
  hasComplexLogicalExpression,
  validateFilterIrSemantics,
} from '../types';
import { QueryAdapter } from '../contracts/query-adapter.interface';

interface ValidationResultWithParsedQuery {
  isValid: boolean;
  errors: FilterValidationIssue[];
  warnings: FilterValidationIssue[];
  parsedQuery?: unknown;
}

interface ValidatorWithQuerySupport<TSchema = unknown> {
  validateQuery?(
    query: Query,
    schema?: TSchema,
    context?: unknown,
  ): ValidationResultWithParsedQuery;
}

interface FormatWithParsedQuerySupport {
  parse(query: Query): FilterIR;
  buildFilterIrFromValidation?(parsedQuery: unknown, query: Query): FilterIR;
}

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
    const rawValidation = this.validateQueryIfNeeded(
      normalizedQuery,
      formatName,
      request.pipeline,
    );
    this.throwIfRawValidationFailed(formatName, rawValidation);

    const formatRegistration = this.registry.getFormatRegistration(formatName);
    const format = formatRegistration.format;
    const normalized = this.resolveNormalizedFilter(
      format,
      normalizedQuery,
      rawValidation.result?.parsedQuery,
    );
    this.validateNormalizedQuery(normalized);
    this.validatePolicy(normalized, request.pipeline?.policy, request.pipeline?.validationContext);
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

  audit<TQueryResult, TOptions = unknown>(
    query: string | Query,
    formatName: string,
    ormName: string,
    options?: TOptions,
  ): FilterAuditResult<TQueryResult> {
    return this.auditWith<TQueryResult, TOptions>({
      query,
      formatName,
      ormName,
      adapterOptions: options,
    });
  }

  auditWith<TQueryResult, TAdapterOptions = unknown, TSchema = unknown>(
    request: FilterProcessRequest<TAdapterOptions, TSchema>,
  ): FilterAuditResult<TQueryResult> {
    const normalizedQuery = this.normalizeQuery(request.query);
    const appliedValidationRules: AppliedValidationRuleDiagnostic[] = [];
    const validationErrors: FilterValidationIssue[] = [];
    const validationWarnings: FilterValidationIssue[] = [];
    const unsupportedFeatures =
      [] as FilterAuditResult<TQueryResult>['unsupportedFeatures'];
    const formatName = request.formatName ?? this.runtimeOptions.defaultFormat;
    const adapterName = request.ormName ?? this.runtimeOptions.defaultOrm;

    if (!formatName) {
      return this.createAuditFailure(
        normalizedQuery,
        appliedValidationRules,
        validationErrors,
        validationWarnings,
        unsupportedFeatures,
        {
          stage: 'request',
          message:
            'Filter format name is required when no default format is configured',
        },
      );
    }

    if (!adapterName) {
      return this.createAuditFailure(
        normalizedQuery,
        appliedValidationRules,
        validationErrors,
        validationWarnings,
        unsupportedFeatures,
        {
          stage: 'request',
          message:
            'Adapter name is required when no default adapter is configured',
        },
        formatName,
      );
    }

    const rawValidation = this.validateQueryIfNeeded(
      normalizedQuery,
      formatName,
      request.pipeline,
    );
    appliedValidationRules.push(
      this.createRawValidationRule(formatName, rawValidation),
    );
    if (rawValidation.result) {
      validationErrors.push(...rawValidation.result.errors);
      validationWarnings.push(...rawValidation.result.warnings);
    }

    let formatRegistration: ReturnType<FilterRegistry['getFormatRegistration']>;
    try {
      formatRegistration = this.registry.getFormatRegistration(formatName);
    } catch (error) {
      return this.createAuditFailure(
        normalizedQuery,
        appliedValidationRules,
        validationErrors,
        validationWarnings,
        unsupportedFeatures,
        this.toAuditError('request', error),
        formatName,
        adapterName,
      );
    }

    let normalized: FilterIR;
    try {
      normalized = this.resolveNormalizedFilter(
        formatRegistration.format,
        normalizedQuery,
        rawValidation.result?.parsedQuery,
      );
      appliedValidationRules.push({
        code: 'FORMAT_PARSE',
        stage: 'parsing',
        status: 'passed',
        message: `Format "${formatName}" parsed the query successfully`,
        targetType: 'format',
        targetName: formatName,
      });
    } catch (error) {
      appliedValidationRules.push({
        code: 'FORMAT_PARSE',
        stage: 'parsing',
        status: 'failed',
        message: `Format "${formatName}" failed to parse the query`,
        targetType: 'format',
        targetName: formatName,
      });

      return this.createAuditFailure(
        normalizedQuery,
        appliedValidationRules,
        validationErrors,
        validationWarnings,
        unsupportedFeatures,
        this.toAuditError('parsing', error),
        formatName,
        adapterName,
      );
    }

    const semanticIssues = validateFilterIrSemantics(normalized);
    appliedValidationRules.push(
      this.createSemanticValidationRule(semanticIssues),
    );
    if (semanticIssues.length > 0) {
      validationErrors.push(...semanticIssues);
    }

    const policyEvaluation = evaluateFilterPolicy(
      normalized,
      this.resolvePolicy(request.pipeline?.policy),
      request.pipeline?.validationContext,
    );
    appliedValidationRules.push(this.createPolicyRule(policyEvaluation.errors));
    if (policyEvaluation.errors.length > 0) {
      validationErrors.push(...policyEvaluation.errors);
    }

    const formatMissingCapabilities = this.getMissingCapabilities(
      formatRegistration.capabilities,
      normalized,
    );
    appliedValidationRules.push(
      this.createCapabilityRule(
        'format',
        formatName,
        formatMissingCapabilities,
      ),
    );
    unsupportedFeatures.push(
      ...formatMissingCapabilities.map((feature) => ({
        targetType: 'format' as const,
        targetName: formatName,
        feature,
        message: `Format "${formatName}" does not support: ${feature}`,
      })),
    );

    let adapterRegistration: ReturnType<FilterRegistry['getAdapterRegistration']>;
    let adapter: QueryAdapter<TQueryResult, TAdapterOptions>;
    try {
      adapter = this.registry.getAdapter<TQueryResult, TAdapterOptions>(adapterName);
      adapterRegistration = this.registry.getAdapterRegistration(adapterName);
    } catch (error) {
      return this.createAuditFailure(
        normalizedQuery,
        appliedValidationRules,
        validationErrors,
        validationWarnings,
        unsupportedFeatures,
        this.toAuditError('request', error),
        formatName,
        adapterName,
        normalized,
      );
    }

    const adapterMissingCapabilities = this.getMissingCapabilities(
      adapterRegistration.capabilities,
      normalized,
    );
    appliedValidationRules.push(
      this.createCapabilityRule(
        'adapter',
        adapterName,
        adapterMissingCapabilities,
      ),
    );
    unsupportedFeatures.push(
      ...adapterMissingCapabilities.map((feature) => ({
        targetType: 'adapter' as const,
        targetName: adapterName,
        feature,
        message: `Adapter "${adapterName}" does not support: ${feature}`,
      })),
    );

    const chosenAdapterStrategy = this.describeAdapterStrategy(
      adapter,
      adapterRegistration.metadata,
      normalized,
      request.adapterOptions,
    );

    let result: TQueryResult | undefined;
    let error:
      | FilterAuditResult<TQueryResult>['error']
      | undefined;

    const canConvert =
      validationErrors.length === 0 && unsupportedFeatures.length === 0;

    if (canConvert) {
      try {
        result = adapter.convert(normalized, request.adapterOptions) as TQueryResult;
        appliedValidationRules.push({
          code: 'ADAPTER_CONVERT',
          stage: 'adapter-convert',
          status: 'passed',
          message: `Adapter "${adapterName}" converted the IR successfully`,
          targetType: 'adapter',
          targetName: adapterName,
        });
      } catch (conversionError) {
        appliedValidationRules.push({
          code: 'ADAPTER_CONVERT',
          stage: 'adapter-convert',
          status: 'failed',
          message: `Adapter "${adapterName}" failed while converting the IR`,
          targetType: 'adapter',
          targetName: adapterName,
        });
        error = this.toAuditError('adapter-convert', conversionError);
      }
    } else {
      appliedValidationRules.push({
        code: 'ADAPTER_CONVERT',
        stage: 'adapter-convert',
        status: 'skipped',
        message:
          'Adapter conversion was skipped because validation or capability checks failed',
        targetType: 'processor',
        targetName: 'FilterProcessor',
      });
    }

    return {
      ok:
        validationErrors.length === 0 &&
        unsupportedFeatures.length === 0 &&
        !error,
      formatName,
      adapterName,
      query: normalizedQuery,
      parsedAst: this.buildDiagnosticAst(normalized),
      filterIr: normalized,
      appliedValidationRules,
      validationErrors,
      validationWarnings,
      unsupportedFeatures,
      chosenAdapterStrategy,
      result,
      error,
    };
  }

  private validateNormalizedQuery(normalized: FilterIR): void {
    const issues = validateFilterIrSemantics(normalized);

    if (issues.length === 0) {
      return;
    }

    throw new BadRequestException({
      message: 'Filter semantic validation failed',
      errors: issues,
      warnings: [],
    });
  }

  private normalizeQuery(query: string | Query): Query {
    return typeof query === 'string' ? { filterString: query } : query;
  }

  private validateQueryIfNeeded<TSchema>(
    query: Query,
    formatName: string,
    pipeline?: FilterProcessRequest<unknown, TSchema>['pipeline'],
  ): {
    shouldValidate: boolean;
    validatorRegistered: boolean;
    result?: ValidationResultWithParsedQuery;
  } {
    const shouldValidate =
      pipeline?.validate ?? this.runtimeOptions.enableValidation ?? false;

    if (!shouldValidate) {
      return {
        shouldValidate,
        validatorRegistered: false,
      };
    }

    const validator = this.registry.getValidator<TSchema>(formatName) as
      | (ValidatorWithQuerySupport<TSchema> & {
          validate(
            queryString: string,
            schema?: TSchema,
            context?: unknown,
          ): ValidationResultWithParsedQuery;
        })
      | undefined;

    if (!validator) {
      return {
        shouldValidate,
        validatorRegistered: false,
      };
    }

    const result =
      !this.shouldDisableValidationReuse() && validator.validateQuery
        ? validator.validateQuery(
            query,
            pipeline?.schema,
            pipeline?.validationContext,
          )
        : validator.validate(
            query.filterString,
            pipeline?.schema,
            pipeline?.validationContext,
          );

    return {
      shouldValidate,
      validatorRegistered: true,
      result: {
        isValid: result.isValid,
        errors: result.errors,
        warnings: result.warnings,
        parsedQuery: result.parsedQuery,
      },
    };
  }

  private resolveNormalizedFilter(
    format: FormatWithParsedQuerySupport,
    query: Query,
    parsedQuery?: unknown,
  ): FilterIR {
    if (
      parsedQuery !== undefined &&
      !this.shouldDisableValidationReuse() &&
      format.buildFilterIrFromValidation
    ) {
      return format.buildFilterIrFromValidation(parsedQuery, query);
    }

    return format.parse(query);
  }

  private validateCapabilities(
    targetType: 'Format' | 'Adapter',
    targetName: string,
    capabilities: FilterCapabilities | undefined,
    normalized: FilterIR,
  ): void {
    const missingFeatures = this.getMissingCapabilities(capabilities, normalized);

    if (missingFeatures.length === 0) {
      return;
    }

    throw new BadRequestException(
      `${targetType} "${targetName}" does not support: ${missingFeatures.join(', ')}`,
    );
  }

  private validatePolicy(
    normalized: FilterIR,
    requestPolicy: FilterRuntimeOptions['policy'],
    context?: FilterPolicyContext,
  ): void {
    const result = evaluateFilterPolicy(
      normalized,
      this.resolvePolicy(requestPolicy),
      context,
    );

    if (result.errors.length === 0) {
      return;
    }

    throw new BadRequestException({
      message: 'Filter policy validation failed',
      errors: result.errors,
      warnings: result.warnings,
    });
  }

  private getMissingCapabilities(
    capabilities: FilterCapabilities | undefined,
    normalized: FilterIR,
  ): string[] {
    if (!capabilities) {
      return [];
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

    return missingFeatures;
  }

  private createRawValidationRule(
    formatName: string,
    validation: ReturnType<FilterProcessor['validateQueryIfNeeded']>,
  ): AppliedValidationRuleDiagnostic {
    if (!validation.shouldValidate) {
      return {
        code: 'FORMAT_VALIDATOR',
        stage: 'validation',
        status: 'skipped',
        message: 'Raw query validation is disabled for this request',
        targetType: 'validator',
        targetName: formatName,
      };
    }

    if (!validation.validatorRegistered) {
      return {
        code: 'FORMAT_VALIDATOR',
        stage: 'validation',
        status: 'skipped',
        message: `No validator is registered for format "${formatName}"`,
        targetType: 'validator',
        targetName: formatName,
      };
    }

    return {
      code: 'FORMAT_VALIDATOR',
      stage: 'validation',
      status: validation.result?.isValid === false ? 'failed' : 'passed',
      message:
        validation.result?.isValid === false
          ? `Raw query validation failed for format "${formatName}"`
          : `Raw query validation passed for format "${formatName}"`,
      targetType: 'validator',
      targetName: formatName,
      details: {
        errorCount: validation.result?.errors.length ?? 0,
        warningCount: validation.result?.warnings.length ?? 0,
      },
    };
  }

  private createSemanticValidationRule(
    issues: FilterValidationIssue[],
  ): AppliedValidationRuleDiagnostic {
    return {
      code: 'FILTER_IR_SEMANTICS',
      stage: 'semantic-validation',
      status: issues.length > 0 ? 'failed' : 'passed',
      message:
        issues.length > 0
          ? 'Neutral filter IR semantic validation failed'
          : 'Neutral filter IR semantic validation passed',
      targetType: 'processor',
      targetName: 'FilterProcessor',
      details: {
        issueCount: issues.length,
      },
    };
  }

  private createPolicyRule(
    issues: FilterValidationIssue[],
  ): AppliedValidationRuleDiagnostic {
    return {
      code: 'POLICY_LAYER',
      stage: 'policy',
      status: issues.length > 0 ? 'failed' : 'passed',
      message:
        issues.length > 0
          ? 'Policy layer rejected the filter request'
          : 'Policy layer accepted the filter request',
      targetType: 'processor',
      targetName: 'FilterProcessor',
      details: {
        issueCount: issues.length,
      },
    };
  }

  private createCapabilityRule(
    targetType: 'format' | 'adapter',
    targetName: string,
    missingFeatures: string[],
  ): AppliedValidationRuleDiagnostic {
    return {
      code: 'CAPABILITY_CHECK',
      stage: 'capability-check',
      status: missingFeatures.length > 0 ? 'failed' : 'passed',
      message:
        missingFeatures.length > 0
          ? `${targetType === 'format' ? 'Format' : 'Adapter'} "${targetName}" is missing required capabilities`
          : `${targetType === 'format' ? 'Format' : 'Adapter'} "${targetName}" satisfies required capabilities`,
      targetType,
      targetName,
      details: {
        missingFeatures,
      },
    };
  }

  private describeAdapterStrategy<TQueryResult, TAdapterOptions>(
    adapter: QueryAdapter<TQueryResult, TAdapterOptions>,
    metadata: Record<string, unknown> | undefined,
    normalized: FilterIR,
    options?: TAdapterOptions,
  ): AdapterStrategyDiagnostic {
    if (adapter.describeStrategy) {
      return adapter.describeStrategy(normalized, options);
    }

    return {
      adapterName: adapter.ormName,
      family: typeof metadata?.family === 'string' ? metadata.family : undefined,
      engine: typeof metadata?.engine === 'string' ? metadata.engine : undefined,
      mode: 'generic-convert',
      usesLogicalExpression: hasComplexLogicalExpression(normalized),
      usesAggregation: Boolean(normalized.aggregation),
      usesRelations: this.getRelationCount(normalized) > 0,
      usesProjection: (getProjectionFields(normalized)?.length ?? 0) > 0,
      notes: [
        getPredicates(normalized).length > 0
          ? 'Includes predicate filters'
          : 'No predicate filters detected',
        getSorting(normalized).length > 0
          ? 'Includes sorting instructions'
          : 'No sorting instructions detected',
      ],
    };
  }

  private buildDiagnosticAst(normalized: FilterIR): FilterIR['expression'] {
    if (normalized.expression) {
      return normalized.expression;
    }

    const predicates = getPredicates(normalized);

    if (predicates.length === 0) {
      return undefined;
    }

    if (predicates.length === 1) {
      return createPredicateNode(predicates[0]);
    }

    return createLogicalGroupNode(
      'and',
      predicates.map((predicate) => createPredicateNode(predicate)),
    );
  }

  private createAuditFailure<TQueryResult>(
    query: Query,
    appliedValidationRules: AppliedValidationRuleDiagnostic[],
    validationErrors: FilterValidationIssue[],
    validationWarnings: FilterValidationIssue[],
    unsupportedFeatures: FilterAuditResult<TQueryResult>['unsupportedFeatures'],
    error: NonNullable<FilterAuditResult<TQueryResult>['error']>,
    formatName?: string,
    adapterName?: string,
    filterIr?: FilterIR,
  ): FilterAuditResult<TQueryResult> {
    return {
      ok: false,
      formatName,
      adapterName,
      query,
      parsedAst: filterIr ? this.buildDiagnosticAst(filterIr) : undefined,
      filterIr,
      appliedValidationRules,
      validationErrors,
      validationWarnings,
      unsupportedFeatures,
      error,
    };
  }

  private toAuditError(
    stage: FilterAuditError['stage'],
    error: unknown,
  ): NonNullable<FilterAuditResult['error']> {
    if (error instanceof BadRequestException) {
      return {
        stage,
        message: error.message,
        details: error.getResponse(),
      };
    }

    if (error instanceof Error) {
      return {
        stage,
        message: error.message,
      };
    }

    return {
      stage,
      message: 'Unknown audit error',
      details: error,
    };
  }

  private throwIfRawValidationFailed(
    formatName: string,
    validation: ReturnType<FilterProcessor['validateQueryIfNeeded']>,
  ): void {
    if (!validation.result || validation.result.isValid) {
      return;
    }

    throw new BadRequestException({
      message: `Filter validation failed for format "${formatName}"`,
      errors: validation.result.errors,
      warnings: validation.result.warnings,
    });
  }

  private resolvePolicy(
    requestPolicy: FilterRuntimeOptions['policy'] | undefined,
  ): FilterRuntimeOptions['policy'] | undefined {
    if (!this.runtimeOptions.policy && !requestPolicy) {
      return undefined;
    }

    return {
      ...(this.runtimeOptions.policy ?? {}),
      ...(requestPolicy ?? {}),
      regex: {
        ...(this.runtimeOptions.policy?.regex ?? {}),
        ...(requestPolicy?.regex ?? {}),
      },
    };
  }

  private getRelationCount(normalized: FilterIR): number {
    const relations = getRelations(normalized);

    if (!relations) {
      return 0;
    }

    return Array.isArray(relations) ? relations.length : 1;
  }

  private shouldDisableValidationReuse(): boolean {
    return process.env.QUERY_REQUEST_DISABLE_VALIDATION_PARSE_REUSE === '1';
  }
}
