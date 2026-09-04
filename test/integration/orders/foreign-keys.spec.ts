import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

/**
 * User Story 1 scenarios 3 and 4. FR-006 and FR-010: every reference in this
 * model is enforced by the database, not by the write path being careful.
 */
describe('referential integrity', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it('rejects a line item naming an order that does not exist', () => {
    const productId = insertProduct(connection);

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO order_line_items
             (order_id, product_id, product_description, unit_price_minor, quantity)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(9999, productId, 'orphan', 100, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('rejects an order naming a customer that does not exist', () => {
    expect(() =>
      connection.sqlite
        .prepare('INSERT INTO orders (customer_id, created_at_us, updated_at_us) VALUES (?, ?, ?)')
        .run(9999, 1, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('rejects a line item naming a product that does not exist', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'real', unitPriceMinor: 100, quantity: 1 }],
    });

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO order_line_items
             (order_id, product_id, product_description, unit_price_minor, quantity)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(orderId, 9999, 'orphan', 100, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  /** FR-010b: quantity is a property of a line, not of a product within an order. */
  it('permits the same product on several line items of one order', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);

    const orderId = insertOrder(connection, {
      customerId,
      lines: [
        { productId, productDescription: 'plain', unitPriceMinor: 500, quantity: 1 },
        { productId, productDescription: 'gift wrapped', unitPriceMinor: 750, quantity: 2 },
      ],
    });

    const count = connection.sqlite
      .prepare('SELECT COUNT(*) AS c FROM order_line_items WHERE order_id = ? AND product_id = ?')
      .get(orderId, productId) as { c: number };

    expect(count.c).toBe(2);
  });
});
