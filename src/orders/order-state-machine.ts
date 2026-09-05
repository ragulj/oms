import { ORDER_STATUSES, type OrderStatus } from '../database/schema';

/**
 * Constitution Principle I, and FR-058 to FR-064. The complete transition graph,
 * and the only authority on whether a change is permitted.
 *
 * Nothing leaves `processing` or `cancelled`. The status set carries no
 * completion or compensation value, so a cancellation after promotion would put
 * the order in a state this model cannot describe. That is a scope decision
 * recorded in the specification's clarifications, not an omission.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['processing', 'cancelled'],
  processing: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * FR-060. The inverse question, which is the one a caller actually needs: it
 * feeds the expected-status predicate of the conditional update directly, so no
 * call site restates a rule that lives here.
 */
export function sourceStatusesFor(target: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUSES.filter((from) => canTransition(from, target));
}

export function isTerminal(status: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0;
}
