import { MAX_MINOR_UNITS } from '../database/schema';
import { ApiError } from '../http/api-error';

/**
 * Contract obligation O2 from Spec 002, and FR-024, FR-025, FR-042a.
 *
 * This is the only place in the system that sums money. The order total is the
 * one monetary value no column constraint can bound: the sum spans rows and has
 * an unknown term count, so two individually conforming line totals can exceed
 * the ceiling between them. Every other monetary value is guarded by a CHECK.
 *
 * Having one derivation point is what makes FR-042a true by construction rather
 * than by remembering to repeat the check on each read path.
 */
export function deriveOrderTotalMinor(lineTotalsMinor: readonly number[]): number {
  let total = 0;
  for (const lineTotal of lineTotalsMinor) {
    total += lineTotal;
  }

  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_MINOR_UNITS) {
    throw new OrderTotalNotRepresentableError(total);
  }

  return total;
}

/**
 * Fails loudly rather than returning a rounded value. A total that cannot be
 * stated exactly is not a total.
 */
export class OrderTotalNotRepresentableError extends Error {
  constructor(readonly total: number) {
    super(`Order total ${total} is not exactly representable (ceiling ${MAX_MINOR_UNITS}).`);
    this.name = 'OrderTotalNotRepresentableError';
  }

  toApiError(): ApiError {
    return ApiError.badRequest(
      'ORDER_TOTAL_NOT_REPRESENTABLE',
      'The order total is too large to be represented exactly.',
    );
  }
}
