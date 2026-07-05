import { FilterOperator } from '../types/normalized-filter.interface';
import { FilterMetadata } from './filter-capabilities.interface';
import { FilterValidationIssue } from './filter-format-validator.interface';

export interface FormatOperatorParseUtilities {
  parseList(rawValue: string, label: string): string[];
  parseInteger(rawValue: string, label: string, allowZero?: boolean): number;
  parseBoolean(rawValue: string, label: string): boolean;
  parsePrimitive(rawValue: string): unknown;
  parseObjectLiteral?(rawValue: string): Record<string, unknown>;
  validateDateFormat?(rawValue: string): void;
}

export interface FormatOperatorParseContext<
  TFieldSchema = unknown,
  TValidationContext = unknown,
> extends FormatOperatorParseUtilities {
  formatName: string;
  field: string;
  operator: FilterOperator;
  rawValue: string;
  fieldSchema?: TFieldSchema;
  validationContext?: TValidationContext;
}

export interface FormatOperatorValidationContext<
  TFieldSchema = unknown,
  TValidationContext = unknown,
> {
  formatName: string;
  field: string;
  operator: FilterOperator;
  rawValue: string;
  value: unknown;
  fieldSchema?: TFieldSchema;
  validationContext?: TValidationContext;
}

export interface OperatorPluginIssue {
  field?: string;
  operator?: string;
  value?: unknown;
  message: string;
  code: string;
  level?: 'error' | 'warning';
}

export interface OperatorValidationResult {
  errors?: FilterValidationIssue[];
  warnings?: FilterValidationIssue[];
}

export type OperatorValidationOutcome =
  | void
  | OperatorPluginIssue
  | OperatorPluginIssue[]
  | {
      errors?: OperatorPluginIssue[];
      warnings?: OperatorPluginIssue[];
    };

export interface FormatOperatorPlugin<
  TFieldSchema = unknown,
  TValidationContext = unknown,
> {
  operator: FilterOperator;
  aliases?: string[];
  supportedFieldTypes?: string[];
  metadata?: FilterMetadata;
  parseValue?(
    rawValue: string,
    context: FormatOperatorParseContext<TFieldSchema, TValidationContext>,
  ): unknown;
  validate?(
    context: FormatOperatorValidationContext<TFieldSchema, TValidationContext>,
  ): OperatorValidationOutcome;
}

export interface AdapterOperatorPlugin<TContext = unknown, TResult = unknown> {
  operator: FilterOperator;
  aliases?: string[];
  metadata?: FilterMetadata;
  apply(context: TContext): TResult;
}

export interface FilterOperatorPluginBundle {
  operator: FilterOperator;
  formats?: Record<
    string,
    Omit<FormatOperatorPlugin, 'operator'> & { operator?: FilterOperator }
  >;
  adapters?: Record<
    string,
    Omit<AdapterOperatorPlugin, 'operator'> & { operator?: FilterOperator }
  >;
  metadata?: FilterMetadata;
}
