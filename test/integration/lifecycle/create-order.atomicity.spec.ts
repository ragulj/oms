import { MAX_MINOR_UNITS, orderLineItems, orders, products } from '../../../src/database/schema';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/**
 * User Story 1, and FR-017, FR-020, FR-025, FR-027.
 *
 * Everything here is asserted against storage rather than against the response,
 * because the response is produced by the same code path that would be wrong.
 */
describe('creation is all or nothing', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const stored = () => ({
    orders: harness.connection.db.select().from(orders).all(),
    lines: harness.connection.db.select().from(orderLineItems).all(),
  });

  it('writes nothing when one line names a product that does not exist', async () => {
    const catalog = harness.catalog();

    const response = await api(harness).create(
      orderBody(catalog, [
        { productId: catalog.productId, quantity: 1 },
        { productId: 987_654, quantity: 1 },
        { productId: catalog.otherProductId, quantity: 1 },
      ]),
    );

    expect(response.status).toBe(400);

    // Not even the order row, which is the part a naive implementation writes
    // first and then abandons when a later line fails to resolve.
    expect(stored()).toEqual({ orders: [], lines: [] });
  });

  it('writes nothing when the customer does not exist', async () => {
    const catalog = harness.catalog();

    const response = await api(harness).create({
      customerId: 987_654,
      lines: [{ productId: catalog.productId, quantity: 1 }],
    });

    expect(response.status).toBe(400);
    expect(stored()).toEqual({ orders: [], lines: [] });
  });

  /**
   * FR-025, and the reason Spec 002's contract records obligation O2. Each line
   * total here satisfies the per-column CHECK on its own; their sum does not,
   * and no column constraint can catch that because the sum spans rows.
   */
  it('stores no order whose total is not exactly representable', async () => {
    const catalog = harness.catalog();

    const [expensive] = harness.connection.db
      .insert(products)
      .values({ name: 'Ceiling Widget', unitPriceMinor: MAX_MINOR_UNITS })
      .returning({ id: products.id })
      .all();

    const response = await api(harness).create(
      orderBody(catalog, [
        { productId: expensive!.id, quantity: 1 },
        { productId: expensive!.id, quantity: 1 },
      ]),
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('ORDER_TOTAL_NOT_REPRESENTABLE');

    // The transaction aborted, so neither the order nor its lines survive.
    expect(stored()).toEqual({ orders: [], lines: [] });
  });

  it('accepts an order whose total sits exactly on the ceiling', async () => {
    const catalog = harness.catalog();

    const [expensive] = harness.connection.db
      .insert(products)
      .values({ name: 'Ceiling Widget', unitPriceMinor: MAX_MINOR_UNITS })
      .returning({ id: products.id })
      .all();

    const response = await api(harness).create(
      orderBody(catalog, [{ productId: expensive!.id, quantity: 1 }]),
    );

    expect(response.status).toBe(201);
    expect(response.body.totalMinor).toBe(MAX_MINOR_UNITS);
  });

  /**
   * FR-018 restated as the observable consequence, and the check that makes
   * price capture meaningful rather than merely asserted. Spec 002 proves the
   * stored row does not follow the catalog; this proves the read path does not
   * quietly re-resolve it.
   */
  it('does not follow a later catalog price change', async () => {
    const catalog = harness.catalog();

    const created = await api(harness).create(
      orderBody(catalog, [{ productId: catalog.productId, quantity: 2 }]),
    );
    const capturedPrice = created.body.lines[0].unitPriceMinor as number;
    const capturedTotal = created.body.totalMinor as number;

    harness.connection.sqlite
      .prepare('UPDATE products SET unit_price_minor = ?, name = ? WHERE id = ?')
      .run(capturedPrice * 3 + 7, 'Renamed Widget', catalog.productId);

    const refetched = await api(harness).get(created.body.id);

    expect(refetched.status).toBe(200);
    expect(refetched.body.lines[0].unitPriceMinor).toBe(capturedPrice);
    expect(refetched.body.lines[0].productDescription).not.toBe('Renamed Widget');
    expect(refetched.body.totalMinor).toBe(capturedTotal);
  });
});
