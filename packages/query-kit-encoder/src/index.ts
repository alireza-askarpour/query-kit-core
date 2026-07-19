export * from './types';
export * from './sc-builder';
export * from './mc-builder';

import { MCQueryBuilder } from './mc-builder';
import { SCQueryBuilder } from './sc-builder';

export function createSCQueryBuilder(): SCQueryBuilder {
  return new SCQueryBuilder();
}

export function createMCQueryBuilder(): MCQueryBuilder {
  return new MCQueryBuilder();
}
