import { createConnection, type Connection } from '../../../src/database/client';
import { MAX_MINOR_UNITS } from '../../../src/database/schema';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

/**
 * User Story 2. Constitution Principle IV exists because this failure is silent:
 * a rounding error does not raise, it just makes a total wrong by a unit.
 */
describe('monetary boundaries', () => {
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
      lines: [{ productId, productDescription: 'anchor', unitPriceMinor: 1, quantity: 1 }],
    });
  });

  const insertLine = (unitPriceMinor: unknown, quantity: unknown = 1): void => {
    connection.sqlite
      .prepare(
        `INSERT INTO order_line_items
           (order_id, product_id, product_description, unit_price_minor, quantity)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(orderId, productId, 'probe', unitPriceMinor, quantity);
  };

  const storedPrices = (): unknown[] =>
    (
      connection.sqlite
        .prepare(
          "SELECT unit_price_minor AS p FROM order_line_items WHERE product_description = 'probe'",
        )
        .all() as { p: unknown }[]
    ).map((r) => r.p);

  it.each([0, 1, MAX_MINOR_UNITS])('accepts %d and reads it back exactly', (price) => {
    insertLine(price);
    expect(storedPrices()).toEqual([price]);
  });

  it('rejects a fractional value rather than rounding it', () => {
    expect(() => insertLine(1.5)).toThrow(/CHECK constraint failed/i);
    expect(storedPrices()).toEqual([]);
  });

  it('rejects a negative unit price', () => {
    expect(() => insertLine(-1)).toThrow(/CHECK constraint failed/i);
  });

  it.each([0, -3])('rejects a quantity of %d', (quantity) => {
    expect(() => insertLine(100, quantity)).toThrow(/CHECK constraint failed/i);
  });

  /**
   * The two clauses of the check catch different arrival paths, and a test that
   * exercises only one leaves the other free to be deleted without going red
   * (research.md R7).
   *
   * A plain JavaScript number above the safe range reaches SQLite as a float, so
   * the typeof clause refuses it and the range clause is never consulted. Only a
   * BigInt or a SQL literal arrives as a genuine oversized integer.
   */
  describe('above the ceiling', () => {
    it('refuses a plain number, via the type clause', () => {
      expect(() => insertLine(MAX_MINOR_UNITS + 1)).toThrow(/CHECK constraint failed/i);
    });

    it('refuses a BigInt, via the range clause', () => {
      expect(() => insertLine(BigInt(MAX_MINOR_UNITS) + 1n)).toThrow(/CHECK constraint failed/i);
    });

    it('refuses a SQL literal, via the range clause', () => {
      expect(() =>
        connection.sqlite.exec(
          `INSERT INTO order_line_items
             (order_id, product_id, product_description, unit_price_minor, quantity)
           VALUES (${orderId}, ${productId}, 'probe', 9007199254740992, 1)`,
        ),
      ).toThrow(/CHECK constraint failed/i);
    });

    it('accepts the ceiling itself as a SQL literal', () => {
      connection.sqlite.exec(
        `INSERT INTO order_line_items
           (order_id, product_id, product_description, unit_price_minor, quantity)
         VALUES (${orderId}, ${productId}, 'probe', ${MAX_MINOR_UNITS}, 1)`,
      );
      expect(storedPrices()).toEqual([MAX_MINOR_UNITS]);
    });
  });

  it('applies the same bounds to the product catalog price', () => {
    expect(() =>
      connection.sqlite
        .prepare('INSERT INTO products (name, unit_price_minor) VALUES (?, ?)')
        .run('bad', -1),
    ).toThrow(/CHECK constraint failed/i);
  });
});
