import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { seedManyOrders } from '../../support/order-fixtures';

interface PlanRow {
  detail: string;
}

/**
 * User Story 5. Constitution Principles III and V describe query shapes that are
 * only safe if the database can satisfy them without scanning: an unindexed
 * backlog claim holds the single write lock for the length of a whole-table
 * scan, which is the exact failure Principle III exists to prevent.
 */
describe('committed access patterns are served by indexes', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  beforeEach(() => {
    seedManyOrders(connection, 10_000);
  });

  const plan = (sql: string, params: unknown[] = []): string => {
    const rows = connection.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as PlanRow[];
    return rows.map((r) => r.detail).join(' | ');
  };

  const expectIndexed = (detail: string, index: string, table: string): void => {
    expect(detail).toContain(index);
    expect(detail).toMatch(/SEARCH/);
    expect(detail).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
  };

  /** FR-036: the keyset page, phase one of Principle V's two-phase read. */
  it('serves the keyset page from orders_created_at_id_idx', () => {
    const detail = plan(
      `SELECT id, created_at_us FROM orders
       WHERE (created_at_us, id) < (?, ?)
       ORDER BY created_at_us DESC, id DESC
       LIMIT 50`,
      [1_700_000_000_009_999, 99_999],
    );

    expectIndexed(detail, 'orders_created_at_id_idx', 'orders');
  });

  /** FR-037: the bounded claim from Principle III. */
  it('serves the bounded backlog claim from orders_status_created_at_id_idx', () => {
    const detail = plan(`SELECT id FROM orders WHERE status = ? ORDER BY created_at_us LIMIT 100`, [
      'pending',
    ]);

    expectIndexed(detail, 'orders_status_created_at_id_idx', 'orders');
  });

  it('serves the claim inside its conditional update without scanning', () => {
    const detail = plan(
      `UPDATE orders SET status = 'processing'
       WHERE id IN (SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at_us LIMIT 100)
         AND status = 'pending'`,
    );

    expect(detail).toContain('orders_status_created_at_id_idx');
  });

  /** FR-038: phase two of the two-phase read. */
  it('serves the line item fetch from order_line_items_order_id_idx', () => {
    const detail = plan(
      'SELECT * FROM order_line_items WHERE order_id IN (?, ?, ?, ?, ?)',
      [1, 2, 3, 4, 5],
    );

    expectIndexed(detail, 'order_line_items_order_id_idx', 'order_line_items');
  });

  /**
   * FR-039 and FR-039a: exactly the three indexes the committed access patterns
   * need, and no speculative ones. Each index is a write-time cost paid on every
   * insert, so an extra one should fail this rather than pass unnoticed.
   */
  it('defines exactly three indexes across the order tables', () => {
    const rows = connection.sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND tbl_name IN ('orders', 'order_line_items')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(rows.map((r) => r.name)).toEqual([
      'order_line_items_order_id_idx',
      'orders_created_at_id_idx',
      'orders_status_created_at_id_idx',
    ]);
  });
});
