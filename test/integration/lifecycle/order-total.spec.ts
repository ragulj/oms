import { MAX_MINOR_UNITS } from '../../../src/database/schema';
import {
  deriveOrderTotalMinor,
  OrderTotalNotRepresentableError,
} from '../../../src/orders/order-total';

/**
 * FR-024, FR-025, FR-042a, and Spec 002 contract obligation O2.
 *
 * The order total is the one monetary value no column constraint can bound: the
 * sum spans rows and has an unknown term count, so two individually conforming
 * line totals can exceed the ceiling between them. This is the only place in the
 * system that sums money, so this is where that is caught.
 */
describe('order total derivation', () => {
  it('sums exactly at the boundaries', () => {
    expect(deriveOrderTotalMinor([])).toBe(0);
    expect(deriveOrderTotalMinor([0])).toBe(0);
    expect(deriveOrderTotalMinor([1])).toBe(1);
    expect(deriveOrderTotalMinor([MAX_MINOR_UNITS])).toBe(MAX_MINOR_UNITS);
    expect(deriveOrderTotalMinor([MAX_MINOR_UNITS - 1, 1])).toBe(MAX_MINOR_UNITS);
  });

  it('adds many terms without drift', () => {
    const lines = Array.from({ length: 100 }, (_, i) => i * 7 + 1);
    const expected = lines.reduce((sum, value) => sum + value, 0);

    expect(deriveOrderTotalMinor(lines)).toBe(expected);
    expect(Number.isSafeInteger(deriveOrderTotalMinor(lines))).toBe(true);
  });

  /**
   * The point of the whole function. Two line totals that each satisfy Spec 002's
   * per-column CHECK, whose sum does not, must not come back rounded.
   */
  it('throws rather than rounding when the sum leaves the exact range', () => {
    expect(() => deriveOrderTotalMinor([MAX_MINOR_UNITS, 1])).toThrow(
      OrderTotalNotRepresentableError,
    );
    expect(() => deriveOrderTotalMinor([MAX_MINOR_UNITS, MAX_MINOR_UNITS])).toThrow(
      OrderTotalNotRepresentableError,
    );
  });

  it('reports the failure as a client error rather than a server error', () => {
    try {
      deriveOrderTotalMinor([MAX_MINOR_UNITS, 1]);
      throw new Error('expected the derivation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OrderTotalNotRepresentableError);
      const api = (error as OrderTotalNotRepresentableError).toApiError();
      expect(api.status).toBe(400);
      expect(api.code).toBe('ORDER_TOTAL_NOT_REPRESENTABLE');
      // FR-006: the ceiling is fine to state; nothing internal leaks.
      expect(api.message).not.toMatch(/select|insert|sqlite|[A-Z]:\\/i);
    }
  });

  /**
   * A silently rounded total is what floating point would produce here, so the
   * negative case is worth stating: the function must not return a Number that
   * merely looks plausible.
   */
  it('never returns a value outside the exactly representable range', () => {
    const attempts: number[][] = [
      [MAX_MINOR_UNITS, 1],
      [MAX_MINOR_UNITS, MAX_MINOR_UNITS, MAX_MINOR_UNITS],
    ];

    for (const lines of attempts) {
      let returned: number | undefined;
      try {
        returned = deriveOrderTotalMinor(lines);
      } catch {
        returned = undefined;
      }
      expect(returned).toBeUndefined();
    }
  });
});
