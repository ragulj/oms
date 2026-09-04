import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const ALL_TABLE_NAMES = ['harness_probe'] as const;
