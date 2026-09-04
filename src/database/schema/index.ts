import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export * from './customers';
export * from './products';
export * from './orders';
export * from './order-line-items';

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
 * Constitution Principle VI requires `DELETE FROM` wherever the table permits
 * it and a rebuild only where deletion is refused, so these two lists exist to
 * keep the harness from reaching for the heavier mechanism out of convenience.
 */
export const DELETABLE_TABLE_NAMES = ['harness_probe', 'products', 'customers'] as const;

/** Child before parent: the line item foreign key points at the order. */
export const REBUILT_TABLE_NAMES = ['order_line_items', 'orders'] as const;
