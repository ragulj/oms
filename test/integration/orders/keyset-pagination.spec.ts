import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { seedManyOrders } from '../../support/order-fixtures';

interface Cursor {
  createdAtUs: number;
  id: number;
}

interface OrderRow {
  id: number;
  created_at_us: number;
}

/**
 * User Story 5 scenario 4 and SC-008. Constitution Principle V requires the
 * cursor to carry the full microsecond value together with a unique tiebreaker,
 * because millisecond truncation makes rows sharing a timestamp either repeat
 * across pages or vanish between them.
 */
describe('keyset pagination', () => {
  let connection: Connection;
  const PAGE_SIZE = 137;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  const page = (after: Cursor | undefined): OrderRow[] => {
    if (!after) {
      return connection.sqlite
        .prepare(
          `SELECT id, created_at_us FROM orders
           ORDER BY created_at_us DESC, id DESC LIMIT ?`,
        )
        .all(PAGE_SIZE) as OrderRow[];
    }
    return connection.sqlite
      .prepare(
        `SELECT id, created_at_us FROM orders
         WHERE created_at_us < ? OR (created_at_us = ? AND id < ?)
         ORDER BY created_at_us DESC, id DESC LIMIT ?`,
      )
      .all(after.createdAtUs, after.createdAtUs, after.id, PAGE_SIZE) as OrderRow[];
  };

  const pageAll = (): OrderRow[] => {
    const seen: OrderRow[] = [];
    let cursor: Cursor | undefined;

    for (;;) {
      const rows = page(cursor);
      if (rows.length === 0) break;
      seen.push(...rows);
      const last = rows[rows.length - 1]!;
      cursor = { createdAtUs: last.created_at_us, id: last.id };
      if (rows.length < PAGE_SIZE) break;
    }
    return seen;
  };

  it('returns every order exactly once, with no duplicates and no omissions', () => {
    const { orderCount } = seedManyOrders(connection, 10_000);

    const seen = pageAll();
    const ids = seen.map((r) => r.id);
    const unique = new Set(ids);

    expect(seen).toHaveLength(orderCount);
    expect(unique.size).toBe(orderCount);

    const stored = connection.sqlite.prepare('SELECT id FROM orders ORDER BY id').all() as {
      id: number;
    }[];
    expect([...unique].sort((a, b) => a - b)).toEqual(stored.map((r) => r.id));
  });

  it('keeps a total order across rows that share a creation timestamp', () => {
    const { sharedTimestampUs } = seedManyOrders(connection, 2_000);

    const colliding = connection.sqlite
      .prepare('SELECT id FROM orders WHERE created_at_us = ? ORDER BY id')
      .all(sharedTimestampUs) as { id: number }[];

    expect(colliding.length).toBeGreaterThan(1);

    const seen = pageAll();
    const positions = colliding.map((c) => seen.findIndex((r) => r.id === c.id));

    expect(positions).not.toContain(-1);
    expect(new Set(positions).size).toBe(colliding.length);

    // Contiguous and descending by id, which is the tiebreaker doing its job.
    const sorted = [...positions].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1]! - sorted[0]!).toBe(colliding.length - 1);
  });

  it('reports the same page for the same cursor on every call', () => {
    seedManyOrders(connection, 1_000);

    const first = page(undefined);
    const cursor = {
      createdAtUs: first[first.length - 1]!.created_at_us,
      id: first[first.length - 1]!.id,
    };

    expect(page(cursor)).toEqual(page(cursor));
  });
});
