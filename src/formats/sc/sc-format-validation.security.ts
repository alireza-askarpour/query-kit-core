import { DANGEROUS_PATTERNS } from './sc-format-validation.constants';

export function securityCheck(
  value: unknown,
): { isValid: boolean; message?: string } {
  if (typeof value !== 'string') {
    return { isValid: true };
  }

  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      return { isValid: false, message };
    }
  }

  return { isValid: true };
}
