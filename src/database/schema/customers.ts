import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Placeholder (FR-001a). This table exists so the order's foreign key points at
 * something real and its enforcement is testable. It is owned by no
 * specification yet and is expected to be replaced rather than extended, so it
 * deliberately carries no timestamps, status, soft-delete flag, or index beyond
 * its primary key.
 */
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});
