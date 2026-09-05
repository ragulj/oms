import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../database/client';
import { orderLineItems, orders, type OrderStatus } from '../database/schema';
import type { OrderCursor } from './order-cursor';

/** Satisfied by both the database handle and a transaction handle. */
export type QueryRunner = Pick<Db, 'select' | 'update'>;

export const ORDER_COLUMNS = {
  id: orders.id,
  customerId: orders.customerId,
  status: orders.status,
  createdAtUs: orders.createdAtUs,
  updatedAtUs: orders.updatedAtUs,
} as const;

export const LINE_COLUMNS = {
  id: orderLineItems.id,
  orderId: orderLineItems.orderId,
  productId: orderLineItems.productId,
  productDescription: orderLineItems.productDescription,
  unitPriceMinor: orderLineItems.unitPriceMinor,
  quantity: orderLineItems.quantity,
  lineTotalMinor: orderLineItems.lineTotalMinor,
} as const;

export interface OrderPageOptions {
  limit: number;
  cursor?: OrderCursor;
  status?: OrderStatus;
}

/**
 * Phase one of Constitution Principle V's two-phase read, and the bounded claim's
 * sibling. These builders live here rather than inline in the service so that the
 * query-plan tests can explain the query that actually ships instead of a copy of
 * it written in a test file, which is a copy that drifts.
 */
export function orderPageQuery(db: QueryRunner, options: OrderPageOptions) {
  const conditions = [];

  if (options.status) {
    conditions.push(eq(orders.status, options.status));
  }

  if (options.cursor) {
    // A row-value comparison rather than the equivalent OR form. Under a status
    // filter the OR form leaves the timestamp unconstrained and walks the whole
    // status; this one seeks straight to the cursor position. See research R4.
    conditions.push(
      sql`(${orders.createdAtUs}, ${orders.id}) < (${options.cursor.createdAtUs}, ${options.cursor.id})`,
    );
  }

  return db
    .select(ORDER_COLUMNS)
    .from(orders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAtUs), desc(orders.id))
    .limit(options.limit);
}

/** Phase two: the lines for exactly the identifiers phase one returned. */
export function orderLinesQuery(db: QueryRunner, orderIds: readonly number[]) {
  return db
    .select(LINE_COLUMNS)
    .from(orderLineItems)
    .where(inArray(orderLineItems.orderId, [...orderIds]));
}

/**
 * Constitution Principle III's bounded claim, in the shape the principle writes
 * out literally. The outer status predicate is not redundant with the subquery's:
 * it is what excludes an order cancelled in the interval between the subquery
 * choosing it and the update reaching it.
 */
export function backlogClaimQuery(
  db: QueryRunner,
  sources: readonly OrderStatus[],
  target: OrderStatus,
  chunkSize: number,
) {
  const candidates = db
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.status, [...sources]))
    .orderBy(asc(orders.createdAtUs), asc(orders.id))
    .limit(chunkSize);

  return db
    .update(orders)
    .set({ status: target })
    .where(and(inArray(orders.id, candidates), inArray(orders.status, [...sources])));
}
