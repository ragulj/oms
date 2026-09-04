import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

interface StoredLine {
  id: number;
  order_id: number;
  product_id: number;
  product_description: string;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
}

/**
 * User Story 3. Constitution Principle IV requires this to hold at the database
 * level precisely because an application-layer rule is one forgotten code path
 * away from failing, so every case here goes through raw SQL rather than through
 * any helper that could be enforcing the rule itself.
 */
describe('historical line items are immutable', () => {
  let connection: Connection;
  let lineId: number;
  let orderId: number;
  let productId: number;
  let before: StoredLine;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  beforeEach(() => {
    const customerId = insertCustomer(connection);
    productId = insertProduct(connection);
    orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'Sprocket', unitPriceMinor: 2500, quantity: 3 }],
    });
    before = connection.sqlite
      .prepare('SELECT * FROM order_line_items WHERE order_id = ?')
      .get(orderId) as StoredLine;
    lineId = before.id;
  });

  const current = (): StoredLine =>
    connection.sqlite
      .prepare('SELECT * FROM order_line_items WHERE id = ?')
      .get(lineId) as StoredLine;

  it.each([
    ['captured unit price', 'unit_price_minor', 1],
    ['quantity', 'quantity', 99],
    ['order reference', 'order_id', 1],
    ['product reference', 'product_id', 1],
    ['product description', 'product_description', 'rewritten'],
  ])('aborts an update to the %s', (_label, column, value) => {
    expect(() =>
      connection.sqlite
        .prepare(`UPDATE order_line_items SET ${column} = ? WHERE id = ?`)
        .run(value, lineId),
    ).toThrow(/immutable/i);

    expect(current()).toEqual(before);
  });

  it('aborts an update that changes nothing', () => {
    expect(() =>
      connection.sqlite
        .prepare('UPDATE order_line_items SET quantity = quantity WHERE id = ?')
        .run(lineId),
    ).toThrow(/immutable/i);
  });

  /** FR-025a: a deletion rewrites history exactly as effectively as an update. */
  it('aborts a direct delete and leaves the row in place', () => {
    expect(() =>
      connection.sqlite.prepare('DELETE FROM order_line_items WHERE id = ?').run(lineId),
    ).toThrow(/cannot be deleted/i);

    expect(current()).toEqual(before);
  });

  it('aborts a delete that names no row in particular', () => {
    expect(() => connection.sqlite.exec('DELETE FROM order_line_items')).toThrow(
      /cannot be deleted/i,
    );

    expect(current()).toEqual(before);
  });

  /** FR-024: the creation timestamp is the ordering column, so it is frozen. */
  it("aborts an update to an order's creation timestamp", () => {
    const stored = connection.sqlite
      .prepare('SELECT created_at_us AS c FROM orders WHERE id = ?')
      .get(orderId) as { c: number };

    expect(() =>
      connection.sqlite.prepare('UPDATE orders SET created_at_us = ? WHERE id = ?').run(9, orderId),
    ).toThrow(/immutable/i);

    expect(
      (
        connection.sqlite
          .prepare('SELECT created_at_us AS c FROM orders WHERE id = ?')
          .get(orderId) as { c: number }
      ).c,
    ).toBe(stored.c);
  });

  it('permits a status change, which is the one thing an order may do', () => {
    const result = connection.sqlite
      .prepare("UPDATE orders SET status = 'processing' WHERE id = ?")
      .run(orderId);

    expect(result.changes).toBe(1);
  });
});
