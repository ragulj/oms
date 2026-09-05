import { ORDER_STATUSES, type OrderStatus } from '../../../src/database/schema';
import {
  canTransition,
  isTerminal,
  LEGAL_TRANSITIONS,
  sourceStatusesFor,
} from '../../../src/orders/order-state-machine';

/**
 * User Story 4, and FR-058 to FR-063. Constitution Principle I makes this module
 * the single authority on the transition graph, so this is the test that says
 * what the graph is.
 */
describe('the order state machine', () => {
  /**
   * FR-063. Every ordered pair, not just the interesting ones. A status added
   * without declaring its edges fails here rather than passing silently, and a
   * self-transition quietly becoming legal is caught by the same sweep.
   */
  it('gives the expected verdict for every ordered pair of statuses', () => {
    const legal = new Set(['pending>processing', 'pending>cancelled']);

    const verdicts = ORDER_STATUSES.flatMap((from) =>
      ORDER_STATUSES.map((to) => ({ from, to, allowed: canTransition(from, to) })),
    );

    expect(verdicts).toHaveLength(ORDER_STATUSES.length ** 2);

    for (const { from, to, allowed } of verdicts) {
      expect({ from, to, allowed }).toEqual({ from, to, allowed: legal.has(`${from}>${to}`) });
    }
  });

  it('permits nothing out of a terminal status', () => {
    expect(isTerminal('processing')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
  });

  /**
   * FR-060. The inverse lookup is what a caller feeds into the conditional
   * update's predicate, so it has to agree with the forward graph rather than
   * being a second hand-maintained copy of it.
   */
  it('answers which sources permit a target, consistently with the forward graph', () => {
    for (const target of ORDER_STATUSES) {
      const sources = sourceStatusesFor(target);

      for (const from of ORDER_STATUSES) {
        expect(sources.includes(from)).toBe(canTransition(from, target));
      }
    }

    expect(sourceStatusesFor('cancelled')).toEqual(['pending']);
    expect(sourceStatusesFor('processing')).toEqual(['pending']);
    expect(sourceStatusesFor('pending')).toEqual([]);
  });

  it('declares an entry for every status the schema allows', () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  /**
   * A status the schema rejects must also be unreachable here. The two would
   * otherwise be able to drift, with the state machine permitting a transition
   * the CHECK constraint refuses to store.
   */
  it('treats an unknown status as reachable from nowhere', () => {
    const unknown = 'shipped' as OrderStatus;

    expect(sourceStatusesFor(unknown)).toEqual([]);
    expect(ORDER_STATUSES).not.toContain(unknown);
  });
});
