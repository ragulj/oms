import { createConnection, type Connection } from '../../../src/database/client';
import { INITIAL_ORDER_STATUS, ORDER_STATUSES } from '../../../src/database/schema';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct, nowUs } from '../../support/order-fixtures';

/**
 * User Story 4. The state machine belongs to a later specification, but it
 * cannot be written against a field that accepts arbitrary text, so the closed
 * set and the default are storage guarantees.
 */
describe('order status', () => {
  let connection: Connection;
  let customerId: number;
  let productId: number;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  beforeEach(() => {
    customerId = insertCustomer(connection);
    productId = insertProduct(connection);
  });

  const newOrder = (): number =>
    insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'p', unitPriceMinor: 100, quantity: 1 }],
    });

  it('permits exactly pending, processing and cancelled', () => {
    expect(ORDER_STATUSES).toEqual(['pending', 'processing', 'cancelled']);

    for (const status of ORDER_STATUSES) {
      const orderId = newOrder();
      const result = connection.sqlite
        .prepare('UPDATE orders SET status = ? WHERE id = ?')
        .run(status, orderId);
      expect(result.changes).toBe(1);
    }
  });

  it.each(['shipped', 'delivered', 'PENDING', '', 'refunded'])(
    'rejects the status %p',
    (status) => {
      const orderId = newOrder();
      expect(() =>
        connection.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId),
      ).toThrow(/CHECK constraint failed/i);
    },
  );

  /** FR-028: the default is applied by the database, not by every write path. */
  it('defaults a new order to pending without the insert supplying it', () => {
    const createdAtUs = nowUs();
    connection.sqlite
      .prepare('INSERT INTO orders (customer_id, created_at_us, updated_at_us) VALUES (?, ?, ?)')
      .run(customerId, createdAtUs, createdAtUs);

    const row = connection.sqlite
      .prepare('SELECT status FROM orders ORDER BY id DESC LIMIT 1')
      .get() as { status: string };

    expect(row.status).toBe(INITIAL_ORDER_STATUS);
    expect(row.status).toBe('pending');
  });

  /**
   * FR-030: the field records the current value only. If it ever starts encoding
   * an ordering, the check constraint is where that would show up first.
   */
  it('encodes no ordering or precedence in the stored value', () => {
    const sql = connection.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
      .get() as { sql: string };

    expect(sql.sql).toMatch(/status.*IN \('pending', 'processing', 'cancelled'\)/s);
    expect(sql.sql).not.toMatch(/status_rank|status_order|next_status/i);
  });
});
