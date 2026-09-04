import { eq } from 'drizzle-orm';
import { createConnection, type Connection } from '../../../src/database/client';
import { orderLineItems } from '../../../src/database/schema';
import { TEST_DB_PATH } from '../../setup/database';
import {
  deriveOrderTotalMinor,
  insertCustomer,
  insertOrder,
  insertProduct,
} from '../../support/order-fixtures';

/**
 * FR-017. The line total is a generated column rather than a checked one: a
 * check would reject a wrong value, this makes one unrepresentable.
 */
describe('line total', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it.each([
    [0, 5, 0],
    [1, 1, 1],
    [2500, 3, 7500],
    [999, 7, 6993],
  ])('computes %d x %d as %d without the insert supplying it', (price, quantity, expected) => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'p', unitPriceMinor: price, quantity }],
    });

    const [line] = connection.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    expect(line!.lineTotalMinor).toBe(expected);
    expect(Number.isInteger(line!.lineTotalMinor)).toBe(true);
  });

  it('refuses an insert that tries to supply the line total itself', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'p', unitPriceMinor: 10, quantity: 1 }],
    });

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO order_line_items
             (order_id, product_id, product_description, unit_price_minor, quantity, line_total_minor)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(orderId, productId, 'forged', 10, 1, 999999),
    ).toThrow(/generated column/i);
  });

  /**
   * FR-019a and contract obligation O2. The derived order total is the one
   * monetary value no column constraint bounds, because the sum has an unknown
   * term count. Two conforming line totals can exceed the ceiling between them,
   * so the derivation fails loudly rather than returning a rounded number.
   */
  it('fails loudly when the derived total would exceed the exact range', () => {
    expect(() => deriveOrderTotalMinor([9_007_199_254_740_991, 9_007_199_254_740_991])).toThrow(
      /exceeds the exactly representable range/i,
    );
  });

  it('derives a total that stays within range', () => {
    expect(deriveOrderTotalMinor([7500, 6993, 0])).toBe(14493);
  });
});
