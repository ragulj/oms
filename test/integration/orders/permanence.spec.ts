import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

/**
 * FR-025b. Permanence is a consequence rather than a rule: an order always has
 * at least one line item, that line item cannot be deleted, and the order cannot
 * be deleted while a line item references it. No separate guard on orders exists,
 * and FR-025b forbids adding one, so this file is what establishes that the
 * consequence actually holds.
 */
describe('orders are permanent', () => {
  let connection: Connection;
  let customerId: number;
  let productId: number;
  let orderId: number;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  beforeEach(() => {
    customerId = insertCustomer(connection);
    productId = insertProduct(connection);
    orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'Sprocket', unitPriceMinor: 2500, quantity: 3 }],
    });
  });

  const orderExists = (): boolean =>
    (
      connection.sqlite.prepare('SELECT COUNT(*) AS c FROM orders WHERE id = ?').get(orderId) as {
        c: number;
      }
    ).c === 1;

  it('refuses to delete an order while a line item references it', () => {
    expect(() => connection.sqlite.prepare('DELETE FROM orders WHERE id = ?').run(orderId)).toThrow(
      /FOREIGN KEY/i,
    );
    expect(orderExists()).toBe(true);
  });

  it('survives every route to removing it that a caller has', () => {
    expect(() => connection.sqlite.exec('DELETE FROM order_line_items')).toThrow();
    expect(() => connection.sqlite.exec('DELETE FROM orders')).toThrow();
    expect(orderExists()).toBe(true);
  });

  /** FR-010a: a catalog edit must not remove financial history as a side effect. */
  it('refuses to delete a referenced customer', () => {
    expect(() =>
      connection.sqlite.prepare('DELETE FROM customers WHERE id = ?').run(customerId),
    ).toThrow(/FOREIGN KEY/i);
    expect(orderExists()).toBe(true);
  });

  it('refuses to delete a referenced product', () => {
    expect(() =>
      connection.sqlite.prepare('DELETE FROM products WHERE id = ?').run(productId),
    ).toThrow(/FOREIGN KEY/i);
    expect(orderExists()).toBe(true);
  });

  it('permits deleting a customer nothing references', () => {
    const spare = insertCustomer(connection, 'Unreferenced');
    const result = connection.sqlite.prepare('DELETE FROM customers WHERE id = ?').run(spare);
    expect(result.changes).toBe(1);
  });

  /**
   * Cancellation is the lifecycle's answer to an unwanted order. This asserts the
   * alternative exists, so the permanence above is a design position rather than
   * a dead end.
   */
  it('offers cancellation instead of deletion', () => {
    const result = connection.sqlite
      .prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'")
      .run(orderId);

    expect(result.changes).toBe(1);
    expect(orderExists()).toBe(true);
  });
});
