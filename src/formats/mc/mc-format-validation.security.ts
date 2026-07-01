import { MC_DANGEROUS_PATTERNS } from './mc-format-validation.constants';

export function mongoSecurityCheck(
  value: unknown,
): { isValid: boolean; message?: string } {
  if (typeof value !== 'string') {
    return { isValid: true };
  }

  for (const { pattern, message } of MC_DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      return { isValid: false, message };
    }
  }

  return { isValid: true };
}
