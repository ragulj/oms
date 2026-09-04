import { eq } from 'drizzle-orm';
import { createConnection, type Connection } from '../../../src/database/client';
import { orderLineItems, products } from '../../../src/database/schema';
import { TEST_DB_PATH } from '../../setup/database';
import { insertCustomer, insertOrder, insertProduct } from '../../support/order-fixtures';

/**
 * FR-014 and FR-025. This is the test the products.unit_price_minor column
 * exists for: without a catalog price to change, price capture could only be
 * asserted, never demonstrated.
 */
describe('price and description are captured at order time', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it('does not follow the catalog when the product changes afterwards', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection, 'Sprocket', 2500);

    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'Sprocket', unitPriceMinor: 2500, quantity: 4 }],
    });

    connection.db
      .update(products)
      .set({ name: 'Sprocket Mk II', unitPriceMinor: 9900 })
      .where(eq(products.id, productId))
      .run();

    const [line] = connection.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    expect(line!.unitPriceMinor).toBe(2500);
    expect(line!.productDescription).toBe('Sprocket');
    expect(line!.lineTotalMinor).toBe(10_000);

    const [product] = connection.db.select().from(products).where(eq(products.id, productId)).all();

    expect(product!.unitPriceMinor).toBe(9900);
    expect(product!.name).toBe('Sprocket Mk II');
  });

  it('keeps the captured description when the catalog name is unrecognisable', () => {
    const customerId = insertCustomer(connection);
    const productId = insertProduct(connection, 'Blue Widget', 100);
    const orderId = insertOrder(connection, {
      customerId,
      lines: [{ productId, productDescription: 'Blue Widget', unitPriceMinor: 100, quantity: 1 }],
    });

    connection.db
      .update(products)
      .set({ name: 'DISCONTINUED-SKU-40122' })
      .where(eq(products.id, productId))
      .run();

    const [line] = connection.db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    expect(line!.productDescription).toBe('Blue Widget');
  });
});
