import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export * from './customers';
export * from './products';
export * from './orders';
export * from './order-line-items';
export * from './idempotency-records';

/**
 * Spec 001 defines no domain entities. This table exists solely so the test
 * harness has something to insert into and clear between tests (FR-017,
 * User Story 3 scenario 1), and so the migration pipeline has real DDL to
 * generate and apply (FR-011, FR-012).
 *
 * `created_at_us` is stored as INTEGER microseconds rather than TEXT or REAL,
 * establishing the convention Constitution Principle V will require of every
 * ordering column once domain tables exist.
 */
export const harnessProbe = sqliteTable('harness_probe', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  note: text('note').notNull(),
  createdAtUs: integer('created_at_us').notNull(),
});

/**
 * Test isolation splits by table, because Spec 002's immutability triggers make
 * row deletion impossible on two of them.
 *
 * Constitution Principle VI requires `DELETE FROM` wherever the table permits it
 * and a rebuild only where deletion is refused, so these lists exist to keep the
 * harness from reaching for the heavier mechanism out of convenience.
 *
 * The three are applied in the order declared below, and that order is not a
 * style choice. Each list states why it sits where it does.
 */

/**
 * Phase 1. These rows hold foreign keys into `orders`, and `DROP TABLE orders`
 * is refused while any of them exist. Clearing them is what makes phase 2
 * possible at all; getting this wrong fails every test that touches an order,
 * with a foreign key error raised during a table drop and nothing in the message
 * pointing here.
 */
export const PRE_REBUILD_TABLE_NAMES = ['idempotency_records'] as const;

/** Phase 2. Child before parent: the line item foreign key points at the order. */
export const REBUILT_TABLE_NAMES = ['order_line_items', 'orders'] as const;

/**
 * Phase 3. Deletable only once phase 2 has dropped the order tables and released
 * the foreign keys pointing into `products` and `customers`.
 */
export const DELETABLE_TABLE_NAMES = ['harness_probe', 'products', 'customers'] as const;
