import type { Connection } from '../../src/database/client';
import { customers, orderLineItems, orders, products } from '../../src/database/schema';
import type { OrderStatus } from '../../src/database/schema';

export interface LineItemInput {
  productId: number;
  productDescription: string;
  unitPriceMinor: number;
  quantity: number;
}

export interface OrderInput {
  customerId: number;
  status?: OrderStatus;
  createdAtUs?: number;
  lines: LineItemInput[];
}

/**
 * Microseconds since the Unix epoch (Constitution Principle V). The runtime
 * clock resolves to milliseconds, so this is exact in its unit but not precise
 * to it. Tests that care about ordering pass an explicit value instead.
 */
export function nowUs(): number {
  return Date.now() * 1000;
}

export function insertCustomer(connection: Connection, name = 'Acme Corp'): number {
  const [row] = connection.db
    .insert(customers)
    .values({ name })
    .returning({ id: customers.id })
    .all();
  return row!.id;
}

export function insertProduct(
  connection: Connection,
  name = 'Widget',
  unitPriceMinor = 1299,
): number {
  const [row] = connection.db
    .insert(products)
    .values({ name, unitPriceMinor })
    .returning({ id: products.id })
    .all();
  return row!.id;
}

/**
 * FR-008: the order and its line items are created in one unit of work, so no
 * reader can observe an order without lines. The schema cannot hold this, since
 * the order row must exist before a line can reference it, so it is enforced
 * here and stated in contracts/persistence.md as obligation O1.
 */
export function insertOrder(connection: Connection, input: OrderInput): number {
  if (input.lines.length === 0) {
    throw new Error('An order must have at least one line item (FR-008)');
  }

  const createdAtUs = input.createdAtUs ?? nowUs();

  return connection.db.transaction((tx) => {
    const [order] = tx
      .insert(orders)
      .values({
        customerId: input.customerId,
        ...(input.status ? { status: input.status } : {}),
        createdAtUs,
        updatedAtUs: createdAtUs,
      })
      .returning({ id: orders.id })
      .all();

    const orderId = order!.id;
    tx.insert(orderLineItems)
      .values(input.lines.map((line) => ({ ...line, orderId })))
      .run();

    return orderId;
  });
}

/** A customer, a product, and one order with `lineCount` lines. */
export function seedOrder(
  connection: Connection,
  lineCount = 2,
): { customerId: number; productId: number; orderId: number } {
  const customerId = insertCustomer(connection);
  const productId = insertProduct(connection);
  const orderId = insertOrder(connection, {
    customerId,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      productId,
      productDescription: `Widget line ${i + 1}`,
      unitPriceMinor: 500 + i,
      quantity: i + 1,
    })),
  });
  return { customerId, productId, orderId };
}

/**
 * FR-018 and contract obligation O2. The order total is derived rather than
 * stored, and the derivation must be exact or fail loudly: the sum has an
 * unknown term count, so two conforming line totals can exceed the FR-019
 * ceiling between them and no column constraint can catch it.
 */
export function deriveOrderTotalMinor(lineTotals: number[]): number {
  const total = lineTotals.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Order total ${total} exceeds the exactly representable range (FR-019a)`);
  }
  return total;
}

export interface BulkSeedResult {
  customerId: number;
  productId: number;
  orderCount: number;
  sharedTimestampUs: number;
}

/**
 * SC-007 and SC-008 need a table large enough that a full scan is
 * distinguishable from an index seek, and orders that deliberately share a
 * creation timestamp so the keyset tiebreaker is actually exercised.
 *
 * Raw prepared statements inside one transaction: this is fixture bulk loading,
 * not application persistence, and the per-test rebuild means it runs again for
 * every test that needs it.
 */
export function seedManyOrders(
  connection: Connection,
  orderCount = 10_000,
  collisionsAt = 500,
): BulkSeedResult {
  const customerId = insertCustomer(connection, 'Bulk Customer');
  const productId = insertProduct(connection, 'Bulk Widget', 1000);
  const baseUs = 1_700_000_000_000_000;
  const sharedTimestampUs = baseUs + collisionsAt;

  const insertOrderRow = connection.sqlite.prepare(
    'INSERT INTO orders (customer_id, status, created_at_us, updated_at_us) VALUES (?, ?, ?, ?)',
  );
  const insertLineRow = connection.sqlite.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_description, unit_price_minor, quantity)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const statuses = ['pending', 'processing', 'cancelled'] as const;

  connection.sqlite.transaction(() => {
    for (let i = 0; i < orderCount; i += 1) {
      // A run of orders sharing one microsecond, so paging has to lean on the
      // primary key tiebreaker rather than on the timestamp being unique.
      const createdAtUs =
        i >= collisionsAt && i < collisionsAt + 5 ? sharedTimestampUs : baseUs + i;
      const status = statuses[i % statuses.length]!;
      const { lastInsertRowid } = insertOrderRow.run(customerId, status, createdAtUs, createdAtUs);
      insertLineRow.run(Number(lastInsertRowid), productId, `line ${i}`, 1000, (i % 3) + 1);
    }
  })();

  return { customerId, productId, orderCount, sharedTimestampUs };
}

/**
 * A backlog of orders in one status, for the bounded-tick assertions. Every
 * order gets one line, because Spec 002's model has no order without lines and
 * contract obligation O1 says a fixture must not create one.
 */
export function seedOrdersInStatus(
  connection: Connection,
  count: number,
  status: OrderStatus = 'pending',
  baseUs = 1_700_000_000_000_000,
): { customerId: number; productId: number; orderIds: number[] } {
  const customerId = insertCustomer(connection, `Backlog Customer ${status}`);
  const productId = insertProduct(connection, `Backlog Widget ${status}`, 1000);

  const insertOrderRow = connection.sqlite.prepare(
    'INSERT INTO orders (customer_id, status, created_at_us, updated_at_us) VALUES (?, ?, ?, ?)',
  );
  const insertLineRow = connection.sqlite.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_description, unit_price_minor, quantity)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const orderIds: number[] = [];
  connection.sqlite.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      // Strictly increasing, so "oldest first" is a checkable claim.
      const createdAtUs = baseUs + i;
      const { lastInsertRowid } = insertOrderRow.run(customerId, status, createdAtUs, createdAtUs);
      const orderId = Number(lastInsertRowid);
      insertLineRow.run(orderId, productId, `backlog line ${i}`, 1000, 1);
      orderIds.push(orderId);
    }
  })();

  return { customerId, productId, orderIds };
}
