import { FilterExpressionNode, FilterIR } from '../types';
import { FilterValidationIssue } from './filter-format-validator.interface';
import { Query } from './filter-format.interface';

export type FilterDiagnosticStage =
  | 'request'
  | 'validation'
  | 'parsing'
  | 'semantic-validation'
  | 'capability-check'
  | 'adapter-strategy'
  | 'adapter-convert';

export type FilterDiagnosticStatus = 'passed' | 'failed' | 'skipped' | 'info';

export interface AppliedValidationRuleDiagnostic {
  code: string;
  stage: FilterDiagnosticStage;
  status: FilterDiagnosticStatus;
  message: string;
  targetType?: 'format' | 'adapter' | 'processor' | 'validator';
  targetName?: string;
  details?: Record<string, unknown>;
}

export interface UnsupportedFeatureDiagnostic {
  targetType: 'format' | 'adapter';
  targetName: string;
  feature: string;
  message: string;
}

export interface AdapterStrategyDiagnostic {
  adapterName: string;
  family?: string;
  engine?: string;
  mode: string;
  dialect?: string;
  usesLogicalExpression: boolean;
  usesAggregation: boolean;
  usesRelations: boolean;
  usesProjection: boolean;
  notes: string[];
  details?: Record<string, unknown>;
}

export interface FilterAuditError {
  stage: FilterDiagnosticStage;
  message: string;
  details?: unknown;
}

export interface FilterAuditResult<TQueryResult = unknown> {
  ok: boolean;
  formatName?: string;
  adapterName?: string;
  query: Query;
  parsedAst?: FilterExpressionNode;
  filterIr?: FilterIR;
  appliedValidationRules: AppliedValidationRuleDiagnostic[];
  validationErrors: FilterValidationIssue[];
  validationWarnings: FilterValidationIssue[];
  unsupportedFeatures: UnsupportedFeatureDiagnostic[];
  chosenAdapterStrategy?: AdapterStrategyDiagnostic;
  result?: TQueryResult;
  error?: FilterAuditError;
}
