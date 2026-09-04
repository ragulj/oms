import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orders } from './orders';
import { MAX_MINOR_UNITS, products } from './products';

/**
 * The financial record of what was charged. Every column here is immutable once
 * written, enforced by triggers rather than by anything in this file, because
 * Drizzle has no way to express a trigger. They live in a hand-written
 * migration; see the plan's Complexity Tracking section for why.
 */
export const orderLineItems = sqliteTable(
  'order_line_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    productDescription: text('product_description').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    quantity: integer('quantity').notNull(),

    // FR-017: a generated column rather than a checked one. A check would reject
    // a wrong value; this makes one unrepresentable, and removes the field from
    // the write path so no caller can supply it at all.
    lineTotalMinor: integer('line_total_minor').generatedAlwaysAs(
      sql`unit_price_minor * quantity`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    // The typeof clause catches non-integers and anything the driver sends as a
    // float; the range clause catches genuine integers that are too large, which
    // can only arrive as a BigInt or a SQL literal. Both paths are real, so both
    // clauses need their own test (research.md R7).
    check(
      'order_line_items_unit_price_minor_valid',
      sql`typeof(${t.unitPriceMinor}) = 'integer' AND ${t.unitPriceMinor} >= 0 AND ${t.unitPriceMinor} <= ${sql.raw(String(MAX_MINOR_UNITS))}`,
    ),
    check(
      'order_line_items_quantity_valid',
      sql`typeof(${t.quantity}) = 'integer' AND ${t.quantity} >= 1`,
    ),

    // FR-038: the second query of the two-phase read. SQLite appends the rowid
    // to index entries, so this also yields deterministic within-order ordering
    // and no separate line number column is needed.
    index('order_line_items_order_id_idx').on(t.orderId),
  ],
);

// No uniqueness across (order_id, product_id): FR-010b permits the same product
// on several lines. product_id is deliberately unindexed (FR-039a).
