import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orders } from './orders';

/** FR-030: the permitted shape of a caller-supplied key. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * FR-034. The unique constraint is the guarantee, not the lookup that precedes
 * it. A request that passes that lookup and then loses the race still fails
 * here, which is why the creation path classifies the driver's
 * SQLITE_CONSTRAINT_UNIQUE and replays instead of trusting what it read.
 *
 * Nothing here is financial history, so Principle IV does not reach this table
 * and its rows can be deleted. That is what lets test isolation clear it by
 * deletion rather than by rebuild.
 */
export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    idempotencyKey: text('idempotency_key').notNull().unique(),

    // FR-030a: a hash of the canonicalised body, so a replay carrying a
    // different request is a detectable conflict rather than a wrong answer.
    requestFingerprint: text('request_fingerprint').notNull(),

    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),

    // FR-035: present so expiry can be added later without a schema change.
    createdAtUs: integer('created_at_us').notNull(),
  },
  (t) => [
    check(
      'idempotency_records_created_at_us_valid',
      sql`typeof(${t.createdAtUs}) = 'integer' AND ${t.createdAtUs} > 0`,
    ),
  ],
);

// order_id is deliberately unindexed: nothing queries in that direction, and the
// unique constraint above already indexes the only column that is looked up.
