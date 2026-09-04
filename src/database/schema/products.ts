import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Largest integer the application runtime represents exactly (FR-019). */
export const MAX_MINOR_UNITS = 9_007_199_254_740_991;

/**
 * Placeholder (FR-001a), with one column that earns its place: the current
 * catalog price. Changing it and observing that a stored line item does not
 * follow is the test that proves price capture (FR-014) works. Without it that
 * guarantee could only be asserted.
 */
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
  },
  (t) => [
    check(
      'products_unit_price_minor_valid',
      sql`typeof(${t.unitPriceMinor}) = 'integer' AND ${t.unitPriceMinor} >= 0 AND ${t.unitPriceMinor} <= ${sql.raw(String(MAX_MINOR_UNITS))}`,
    ),
  ],
);
