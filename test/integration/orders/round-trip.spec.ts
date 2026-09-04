import { eq } from 'drizzle-orm';
import { createConnection, type Connection } from '../../../src/database/client';
import { orderLineItems, orders } from '../../../src/database/schema';
import { TEST_DB_PATH } from '../../setup/database';
import {
  deriveOrderTotalMinor,
  insertCustomer,
  insertOrder,
  insertProduct,
} from '../../support/order-fixtures';

/**
 * User Story 1. Every other guarantee in this feature is a statement about
 * stored data, so none of them mean anything until a round trip is faithful.
 */
describe('order round trip', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it('returns every stored field with the value and type it was given', () => {
    const customerId = insertCustomer(connection, 'Northwind');
    const productId = insertProduct(connection, 'Sprocket', 2500);
    const createdAtUs = 1_700_000_000_000_123;

    const orderId = insertOrder(connection, {
      customerId,
      createdAtUs,
      lines: [
        { productId, productDescription: 'Sprocket, large', unitPriceMinor: 2500, quantity: 3 },
        { productId, productDescription: 'Sprocket, small', unitPriceMinor: 999, quantity: 1 },
      ],
    });

    const [order] = connection.db.select().from(orders).where(eq(orders.id, orderId)).all();

    expect(order).toEqual({
      id: orderId,
      customerId,
      status: 'pending',
      createdAtUs,
      updatedAtUs: createdAtUs,
    });
    expect(Number.isInteger(order!.createdAtUs)).toBe(true);

    const lines = connection.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      id: expect.any(Number),
      orderId,
      productId,
      productDescription: 'Sprocket, large',
      unitPriceMinor: 2500,
      quantity: 3,
      lineTotalMinor: 7500,
    });
  });

  it('rejects an order or line item missing a required field', () => {
    const customerId = insertCustomer(connection);

    expect(() =>
      connection.sqlite
        .prepare('INSERT INTO orders (customer_id, updated_at_us) VALUES (?, ?)')
        .run(customerId, 1),
    ).toThrow(/NOT NULL/i);

    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'x', unitPriceMinor: 1, quantity: 1 }],
    });

    expect(() =>
      connection.sqlite
        .prepare('INSERT INTO order_line_items (order_id, product_id, quantity) VALUES (?, ?, ?)')
        .run(orderId, productId, 1),
    ).toThrow(/NOT NULL/i);
  });

  /** FR-035: the line item has no creation timestamp of its own. */
  it('stores no creation timestamp on a line item and no total on an order', () => {
    const columns = (table: string): string[] =>
      (connection.sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);

    expect(columns('order_line_items')).not.toContain('created_at_us');
    expect(columns('orders')).not.toContain('total_minor');
    expect(columns('orders')).not.toContain('total');
  });

  /** FR-020: single currency, so nothing records which one. */
  it('carries no currency column on any table', () => {
    const rows = connection.sqlite
      .prepare(
        `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name <> '__drizzle_migrations'`,
      )
      .all() as { tbl: string; col: string }[];

    expect(rows.filter((r) => /currency/i.test(r.col))).toEqual([]);
  });

  it('returns line items in a deterministic order identical on every read', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: Array.from({ length: 5 }, (_, i) => ({
        productId,
        productDescription: `line ${i}`,
        unitPriceMinor: 100 * (i + 1),
        quantity: i + 1,
      })),
    });

    const read = (): string[] =>
      connection.db
        .select()
        .from(orderLineItems)
        .where(eq(orderLineItems.orderId, orderId))
        .all()
        .map((l) => l.productDescription);

    const first = read();
    expect(first).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
    expect(read()).toEqual(first);
    expect(read()).toEqual(first);
  });

  /** FR-018: the total is derived from the line items, never stored. */
  it('derives the order total as the sum of its line totals', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [
        { productId, productDescription: 'a', unitPriceMinor: 1999, quantity: 3 },
        { productId, productDescription: 'b', unitPriceMinor: 250, quantity: 2 },
      ],
    });

    const lines = connection.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    expect(deriveOrderTotalMinor(lines.map((l) => l.lineTotalMinor!))).toBe(1999 * 3 + 250 * 2);
  });
});
