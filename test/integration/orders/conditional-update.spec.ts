import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

const CONDITIONAL_UPDATE = 'UPDATE orders SET status = ? WHERE id = ? AND status = ?';

/**
 * User Story 4 scenarios 2, 3, 5 and 6, and the single most important assertion
 * in this feature. Constitution Principle II decides the HTTP 409 response from
 * the changed-row count, so anything that inflates it turns a lost race into a
 * reported success.
 */
describe('conditional status update', () => {
  let connection: Connection;
  let orderId: number;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  beforeEach(() => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'p', unitPriceMinor: 100, quantity: 1 }],
    });
  });

  const timestamps = (): { created: number; updated: number } => {
    const row = connection.sqlite
      .prepare('SELECT created_at_us AS created, updated_at_us AS updated FROM orders WHERE id = ?')
      .get(orderId) as { created: number; updated: number };
    return row;
  };

  it('reports exactly one changed row when the expected status matches', () => {
    const result = connection.sqlite
      .prepare(CONDITIONAL_UPDATE)
      .run('processing', orderId, 'pending');
    expect(result.changes).toBe(1);
  });

  it('reports exactly zero on a repeat, with nothing changed', () => {
    connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'pending');
    const before = timestamps();

    const second = connection.sqlite
      .prepare(CONDITIONAL_UPDATE)
      .run('processing', orderId, 'pending');

    expect(second.changes).toBe(0);
    expect(timestamps()).toEqual(before);
  });

  it('has no third outcome across a full walk of the lifecycle', () => {
    const counts = [
      connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'pending').changes,
      connection.sqlite.prepare(CONDITIONAL_UPDATE).run('cancelled', orderId, 'processing').changes,
      connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'pending').changes,
      connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'cancelled').changes,
    ];

    expect(counts).toEqual([1, 1, 0, 1]);
    expect(counts.every((c) => c === 0 || c === 1)).toBe(true);
  });

  /**
   * FR-034a. The statement names neither timestamp, which is the point: the
   * database maintains it, so no write path can leave it stale and the update
   * keeps the exact shape Principle II mandates.
   */
  it('advances the last-changed timestamp and leaves the creation timestamp alone', () => {
    const before = timestamps();

    connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'pending');
    const after = timestamps();

    expect(after.created).toBe(before.created);
    expect(after.updated).toBeGreaterThan(before.updated);
    expect(after.updated).toBeGreaterThanOrEqual(after.created);
    expect(Number.isSafeInteger(after.updated)).toBe(true);
  });

  it('never moves the last-changed timestamp backwards, even inside one millisecond', () => {
    const seen: number[] = [timestamps().updated];

    connection.sqlite.prepare(CONDITIONAL_UPDATE).run('processing', orderId, 'pending');
    seen.push(timestamps().updated);
    connection.sqlite.prepare(CONDITIONAL_UPDATE).run('cancelled', orderId, 'processing');
    seen.push(timestamps().updated);

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    }
  });

  it('moves no timestamp when the update matches no row', () => {
    const before = timestamps();

    const result = connection.sqlite
      .prepare(CONDITIONAL_UPDATE)
      .run('processing', orderId, 'cancelled');

    expect(result.changes).toBe(0);
    expect(timestamps()).toEqual(before);
  });

  /**
   * FR-034b directly: the touch trigger updates a row, and if that contributed
   * to the caller's count this would read 2 rather than 1.
   */
  it('excludes the trigger row from the count the caller sees', () => {
    const result = connection.sqlite
      .prepare(CONDITIONAL_UPDATE)
      .run('processing', orderId, 'pending');

    expect(result.changes).toBe(1);
    expect(result.changes).not.toBe(2);
  });
});
