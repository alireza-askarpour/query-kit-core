import type {
  AdapterOperatorPlugin,
  FilterOperatorPluginBundle,
  FormatOperatorPlugin,
  OperatorPluginIssue,
  OperatorValidationOutcome,
  OperatorValidationResult,
} from '../contracts/operator-plugin.interface';
import type { FilterValidationIssue } from '../contracts/filter-format-validator.interface';

interface RegistryBucket<TPlugin extends { operator: string; aliases?: string[] }> {
  plugins: Map<string, TPlugin>;
  aliases: Map<string, string>;
}

export class FilterOperatorRegistry {
  private readonly formatPlugins = new Map<
    string,
    RegistryBucket<FormatOperatorPlugin>
  >();

  private readonly adapterPlugins = new Map<
    string,
    RegistryBucket<AdapterOperatorPlugin>
  >();

  registerFormatOperator<TPlugin extends FormatOperatorPlugin>(
    formatName: string,
    plugin: TPlugin,
  ): TPlugin {
    const bucket = this.getOrCreateBucket(this.formatPlugins, formatName);
    const operatorKey = this.normalizeKey(plugin.operator);

    bucket.plugins.set(operatorKey, plugin);
    bucket.aliases.set(operatorKey, plugin.operator);

    for (const alias of plugin.aliases ?? []) {
      bucket.aliases.set(this.normalizeKey(alias), plugin.operator);
    }

    return plugin;
  }

  registerAdapterOperator<TPlugin extends AdapterOperatorPlugin>(
    adapterName: string,
    plugin: TPlugin,
  ): TPlugin {
    const bucket = this.getOrCreateBucket(this.adapterPlugins, adapterName);
    const operatorKey = this.normalizeKey(plugin.operator);

    bucket.plugins.set(operatorKey, plugin);
    bucket.aliases.set(operatorKey, plugin.operator);

    for (const alias of plugin.aliases ?? []) {
      bucket.aliases.set(this.normalizeKey(alias), plugin.operator);
    }

    return plugin;
  }

  registerBundle(bundle: FilterOperatorPluginBundle): void {
    Object.entries(bundle.formats ?? {}).forEach(([formatName, plugin]) => {
      this.registerFormatOperator(formatName, {
        ...plugin,
        operator: plugin.operator ?? bundle.operator,
        metadata: plugin.metadata ?? bundle.metadata,
      });
    });

    Object.entries(bundle.adapters ?? {}).forEach(([adapterName, plugin]) => {
      this.registerAdapterOperator(adapterName, {
        ...plugin,
        operator: plugin.operator ?? bundle.operator,
        metadata: plugin.metadata ?? bundle.metadata,
      });
    });
  }

  getFormatOperator<TPlugin extends FormatOperatorPlugin = FormatOperatorPlugin>(
    formatName: string,
    operatorOrAlias: string,
  ): TPlugin | undefined {
    return this.resolvePlugin(this.formatPlugins, formatName, operatorOrAlias) as
      | TPlugin
      | undefined;
  }

  getAdapterOperator<TPlugin extends AdapterOperatorPlugin = AdapterOperatorPlugin>(
    adapterName: string,
    operatorOrAlias: string,
  ): TPlugin | undefined {
    return this.resolvePlugin(this.adapterPlugins, adapterName, operatorOrAlias) as
      | TPlugin
      | undefined;
  }

  resolveFormatOperatorName(
    formatName: string,
    operatorOrAlias: string,
  ): string | undefined {
    return this.resolveCanonicalOperatorName(
      this.formatPlugins,
      formatName,
      operatorOrAlias,
    );
  }

  listFormatOperators(formatName: string): FormatOperatorPlugin[] {
    return this.listPlugins(this.formatPlugins, formatName);
  }

  clear(): void {
    this.formatPlugins.clear();
    this.adapterPlugins.clear();
  }

  private resolvePlugin<TPlugin extends { operator: string; aliases?: string[] }>(
    collection: Map<string, RegistryBucket<TPlugin>>,
    targetName: string,
    operatorOrAlias: string,
  ): TPlugin | undefined {
    const bucket = collection.get(targetName);

    if (!bucket) {
      return undefined;
    }

    const canonicalName = bucket.aliases.get(this.normalizeKey(operatorOrAlias));

    if (!canonicalName) {
      return undefined;
    }

    return bucket.plugins.get(this.normalizeKey(canonicalName));
  }

  private resolveCanonicalOperatorName<
    TPlugin extends { operator: string; aliases?: string[] },
  >(
    collection: Map<string, RegistryBucket<TPlugin>>,
    targetName: string,
    operatorOrAlias: string,
  ): string | undefined {
    return collection
      .get(targetName)
      ?.aliases.get(this.normalizeKey(operatorOrAlias));
  }

  private listPlugins<TPlugin extends { operator: string; aliases?: string[] }>(
    collection: Map<string, RegistryBucket<TPlugin>>,
    targetName: string,
  ): TPlugin[] {
    return Array.from(collection.get(targetName)?.plugins.values() ?? []);
  }

  private getOrCreateBucket<TPlugin extends { operator: string; aliases?: string[] }>(
    collection: Map<string, RegistryBucket<TPlugin>>,
    targetName: string,
  ): RegistryBucket<TPlugin> {
    const existing = collection.get(targetName);

    if (existing) {
      return existing;
    }

    const bucket: RegistryBucket<TPlugin> = {
      plugins: new Map<string, TPlugin>(),
      aliases: new Map<string, string>(),
    };

    collection.set(targetName, bucket);
    return bucket;
  }

  private normalizeKey(value: string): string {
    return value.trim().toLowerCase();
  }
}

const defaultFilterOperatorRegistry = new FilterOperatorRegistry();

export function getDefaultFilterOperatorRegistry(): FilterOperatorRegistry {
  return defaultFilterOperatorRegistry;
}

export function registerFormatOperator<TPlugin extends FormatOperatorPlugin>(
  formatName: string,
  plugin: TPlugin,
): TPlugin {
  return defaultFilterOperatorRegistry.registerFormatOperator(formatName, plugin);
}

export function registerAdapterOperator<TPlugin extends AdapterOperatorPlugin>(
  adapterName: string,
  plugin: TPlugin,
): TPlugin {
  return defaultFilterOperatorRegistry.registerAdapterOperator(adapterName, plugin);
}

export function registerFilterOperatorBundle(
  bundle: FilterOperatorPluginBundle,
): void {
  defaultFilterOperatorRegistry.registerBundle(bundle);
}

export function normalizeOperatorValidationOutcome(
  outcome: OperatorValidationOutcome,
  defaults?: Partial<FilterValidationIssue>,
): OperatorValidationResult {
  if (!outcome) {
    return {};
  }

  if (Array.isArray(outcome)) {
    return { errors: outcome.map((issue) => toValidationIssue(issue, defaults)) };
  }

  if (isOperatorPluginIssue(outcome)) {
    return { errors: [toValidationIssue(outcome, defaults)] };
  }

  return {
    errors: (outcome.errors ?? []).map((issue) =>
      toValidationIssue(issue, defaults),
    ),
    warnings: (outcome.warnings ?? []).map((issue) =>
      toValidationIssue(issue, defaults),
    ),
  };
}

function isOperatorPluginIssue(value: unknown): value is OperatorPluginIssue {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'message' in value &&
      'code' in value,
  );
}

function toValidationIssue(
  issue: OperatorPluginIssue,
  defaults?: Partial<FilterValidationIssue>,
): FilterValidationIssue {
  return {
    field: issue.field ?? defaults?.field ?? 'query',
    operator: issue.operator ?? defaults?.operator,
    value: issue.value ?? defaults?.value,
    message: issue.message,
    code: issue.code,
  };
}
