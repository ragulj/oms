import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';

/**
 * The closed status set (FR-027). Only values something in the declared scope
 * reaches: `pending` on creation, `processing` from the background promotion
 * job, `cancelled` from the cancellation path a later specification adds.
 *
 * The order of this array carries no meaning. FR-030 forbids the status field
 * from encoding any transition rule, ordering, or precedence; which transitions
 * are legal belongs to the state machine in a later specification.
 */
export const ORDER_STATUSES = ['pending', 'processing', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const INITIAL_ORDER_STATUS: OrderStatus = 'pending';

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default(INITIAL_ORDER_STATUS),
    createdAtUs: integer('created_at_us').notNull(),
    updatedAtUs: integer('updated_at_us').notNull(),
  },
  (t) => [
    check('orders_status_valid', sql`${t.status} IN ('pending', 'processing', 'cancelled')`),
    check(
      'orders_created_at_us_valid',
      sql`typeof(${t.createdAtUs}) = 'integer' AND ${t.createdAtUs} > 0`,
    ),
    check(
      'orders_updated_at_us_valid',
      sql`typeof(${t.updatedAtUs}) = 'integer' AND ${t.updatedAtUs} >= ${t.createdAtUs}`,
    ),

    // FR-036: the keyset page. The primary key is the tiebreaker that makes the
    // sort total when two orders share a microsecond.
    index('orders_created_at_id_idx').on(t.createdAtUs, t.id),

    // FR-037: the bounded backlog claim. Without this index the claim holds the
    // single write lock for the length of a full scan, which is the failure
    // Constitution Principle III exists to prevent.
    index('orders_status_created_at_id_idx').on(t.status, t.createdAtUs, t.id),
  ],
);

// customer_id is deliberately unindexed (FR-039a).
