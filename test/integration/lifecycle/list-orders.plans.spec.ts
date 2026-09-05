import { createConnection, type Connection } from '../../../src/database/client';
import { sourceStatusesFor } from '../../../src/orders/order-state-machine';
import {
  backlogClaimQuery,
  orderLinesQuery,
  orderPageQuery,
} from '../../../src/orders/order-queries';
import { TEST_DB_PATH } from '../../setup/database';
import { seedManyOrders } from '../../support/order-fixtures';

interface PlanRow {
  detail: string;
}

/**
 * User Story 3, FR-054, FR-055, and SC-003.
 *
 * Bounded-memory pagination is unobservable from outside: a listing that reads
 * the whole table into memory returns the same bytes as one that does not. The
 * planner is the only place the difference shows, so it is where the criterion
 * has to be measured.
 *
 * These explain the queries the application actually issues, obtained from the
 * same builders the service and the job call. A plan test that explains SQL
 * retyped in a test file is testing a copy, and the copy drifts.
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
    // Large enough that a scan and a seek are distinguishable to the planner.
    seedManyOrders(connection, 10_000);
  });

  const planOf = (query: { toSQL(): { sql: string; params: unknown[] } }): string => {
    const { sql, params } = query.toSQL();
    const rows = connection.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(params as never[])) as PlanRow[];
    return rows.map((row) => row.detail).join(' | ');
  };

  /**
   * "SCAN x USING INDEX i" and "SEARCH x USING INDEX i" are both acceptable, and
   * the difference is not about cost here. A query with no WHERE clause has
   * nothing to seek on, so the planner walks the index in order and the LIMIT
   * stops it: that reports as SCAN, and it reads only as many entries as the page
   * needs. What must never appear is a bare "SCAN orders", which reads the table
   * itself, or a temporary b-tree, which sorts the whole result before paging it.
   * Those two are the failures bounded-memory pagination is defined against.
   */
  const expectIndexed = (detail: string, index: string, table: string): void => {
    expect(detail).toContain(index);
    expect(detail).toMatch(new RegExp(`(SEARCH|SCAN) ${table} USING (COVERING )?INDEX`));
    expect(detail).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
    expect(detail).not.toContain('TEMP B-TREE');
  };

  const cursor = { createdAtUs: 1_700_000_000_009_999, id: 99_999 };

  it('serves the first page from orders_created_at_id_idx', () => {
    const detail = planOf(orderPageQuery(connection.db, { limit: 50 }));

    expectIndexed(detail, 'orders_created_at_id_idx', 'orders');
  });

  it('serves a cursored page from orders_created_at_id_idx', () => {
    const detail = planOf(orderPageQuery(connection.db, { limit: 50, cursor }));

    expectIndexed(detail, 'orders_created_at_id_idx', 'orders');
    // The cursor must constrain the timestamp, not merely be applied afterwards.
    expect(detail).toContain('created_at_us<?');
  });

  it('serves a filtered first page from orders_status_created_at_id_idx', () => {
    const detail = planOf(orderPageQuery(connection.db, { limit: 50, status: 'pending' }));

    expectIndexed(detail, 'orders_status_created_at_id_idx', 'orders');
  });

  /**
   * The case research R4 was written for, and the reason the predicate is a
   * row-value comparison. The logically identical OR form plans as `status=?`
   * alone here, which walks every row of that status and discards the ones
   * before the cursor: a scan wearing an index's name. This asserts both halves
   * of the constraint, so reverting to the OR form fails rather than merely
   * getting slower.
   */
  it('constrains both status and timestamp on a filtered cursored page', () => {
    const detail = planOf(orderPageQuery(connection.db, { limit: 50, cursor, status: 'pending' }));

    expectIndexed(detail, 'orders_status_created_at_id_idx', 'orders');
    expect(detail).toContain('status=?');
    expect(detail).toContain('created_at_us<?');
  });

  /** FR-038 from Spec 002, exercised here as phase two of the two-phase read. */
  it('serves the line item fetch from order_line_items_order_id_idx', () => {
    const detail = planOf(orderLinesQuery(connection.db, [1, 2, 3, 4, 5]));

    expectIndexed(detail, 'order_line_items_order_id_idx', 'order_line_items');
  });

  /**
   * Constitution Principle III. An unindexed backlog claim holds the single
   * write lock for the length of a whole-table scan, which is the exact failure
   * that principle exists to prevent.
   */
  it('serves the bounded backlog claim from orders_status_created_at_id_idx', () => {
    const detail = planOf(
      backlogClaimQuery(connection.db, sourceStatusesFor('processing'), 'processing', 100),
    );

    expect(detail).toContain('orders_status_created_at_id_idx');
    expect(detail).not.toMatch(/SCAN orders(?! USING)/);
  });

  /**
   * FR-039a from Spec 002, still true after this feature. Every index is a
   * write-time cost paid on every insert, so a speculative one should fail here
   * rather than pass unnoticed.
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

    expect(rows.map((row) => row.name)).toEqual([
      'order_line_items_order_id_idx',
      'orders_created_at_id_idx',
      'orders_status_created_at_id_idx',
    ]);
  });
});
