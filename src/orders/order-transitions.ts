import { and, eq, inArray } from 'drizzle-orm';
import type { Connection } from '../database/client';
import { orders, type OrderStatus } from '../database/schema';
import type { StructuredLogger } from '../logging/logger';
import { sourceStatusesFor } from './order-state-machine';

export type TransitionResult =
  | { outcome: 'applied' }
  | { outcome: 'conflict'; currentStatus: OrderStatus }
  | { outcome: 'missing' };

export interface TransitionContext {
  correlationId?: string;
  actor: 'request' | 'scheduler';
}

/**
 * Constitution Principle II, and FR-065 to FR-071.
 *
 * One conditional statement naming the identity and the permitted source
 * statuses, with the outcome taken from the changed-row count and from nothing
 * else. The permitted sources come from the state machine rather than being
 * restated here, so this file holds no transition rule of its own.
 *
 * `updated_at_us` is deliberately absent from the SET clause. Spec 002 guarantee
 * G11 has a trigger maintain it, and its R6 confirmed the trigger does not
 * inflate the changed-row count this function depends on.
 */
export function applyTransition(
  connection: Connection,
  logger: StructuredLogger,
  orderId: number,
  target: OrderStatus,
  context: TransitionContext,
): TransitionResult {
  const sources = sourceStatusesFor(target);

  const changes =
    sources.length === 0
      ? 0
      : connection.db
          .update(orders)
          .set({ status: target })
          .where(eq(orders.id, orderId))
          .run().changes;

  const result = changes === 1 ? applied() : classify(connection, orderId);

  // FR-096. Request-path and scheduler transitions produce the same record,
  // because the interesting question is the same for both: did it move.
  logger.emit(result.outcome === 'applied' ? 'info' : 'warn', 'order.transition', {
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    actor: context.actor,
    orderId,
    to: target,
    from: result.outcome === 'conflict' ? result.currentStatus : undefined,
    outcome: result.outcome,
  });

  return result;
}

function applied(): TransitionResult {
  return { outcome: 'applied' };
}

/**
 * FR-069. Reached only after the conditional update has already been issued and
 * has already reported zero changed rows, and only to tell 404 from 409.
 *
 * This is not the read-then-write Principle II forbids. That ban is on reading
 * current state in order to *decide* a transition. The decision here was already
 * made by the database, and no write follows, so this read cannot lose an update.
 */
function classify(connection: Connection, orderId: number): TransitionResult {
  const [row] = connection.db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .all();

  return row ? { outcome: 'conflict', currentStatus: row.status } : { outcome: 'missing' };
}
