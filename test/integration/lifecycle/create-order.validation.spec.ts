import { orders } from '../../../src/database/schema';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/**
 * User Story 1, and FR-003, FR-012 to FR-017.
 *
 * The rejected-field cases are the important ones. A plain zod object schema
 * silently discards unknown keys and reports success, so a caller sending
 * `unitPriceMinor` would receive a 201 for a request whose price field was
 * thrown away, with no way to tell. Research R1 has the measurement; these are
 * the tests that would catch the schema being weakened back.
 */
describe('rejecting an invalid creation request', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const expectRejected = async (body: unknown, code: string): Promise<void> => {
    const response = await api(harness).create(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(code);
    expect(harness.connection.db.select().from(orders).all()).toHaveLength(0);
  };

  describe('fields the caller must not supply', () => {
    it.each([
      ['unitPriceMinor', { unitPriceMinor: 1 }],
      ['lineTotalMinor', { lineTotalMinor: 1 }],
      ['totalMinor', { totalMinor: 1 }],
      ['status', { status: 'processing' }],
      ['id', { id: 99 }],
      ['createdAtUs', { createdAtUs: 1 }],
    ])('rejects a body carrying %s', async (_name, extra) => {
      const catalog = harness.catalog();
      await expectRejected({ ...orderBody(catalog), ...extra }, 'VALIDATION_FAILED');
    });

    it('rejects an unknown property on a line item', async () => {
      const catalog = harness.catalog();
      await expectRejected(
        {
          customerId: catalog.customerId,
          lines: [{ productId: catalog.productId, quantity: 1, unitPriceMinor: 5 }],
        },
        'VALIDATION_FAILED',
      );
    });
  });

  describe('line items', () => {
    it('rejects an empty line list', async () => {
      const catalog = harness.catalog();
      await expectRejected({ customerId: catalog.customerId, lines: [] }, 'VALIDATION_FAILED');
    });

    it('rejects more than 100 lines', async () => {
      const catalog = harness.catalog();
      await expectRejected(
        orderBody(
          catalog,
          Array.from({ length: 101 }, () => ({ productId: catalog.productId, quantity: 1 })),
        ),
        'VALIDATION_FAILED',
      );
    });

    it('rejects a missing lines property', async () => {
      const catalog = harness.catalog();
      await expectRejected({ customerId: catalog.customerId }, 'VALIDATION_FAILED');
    });
  });

  describe('quantity', () => {
    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['above the maximum', 1_000_001],
      ['a numeric string', '3'],
      ['null', null],
    ])('rejects a quantity that is %s', async (_name, quantity) => {
      const catalog = harness.catalog();
      await expectRejected(
        { customerId: catalog.customerId, lines: [{ productId: catalog.productId, quantity }] },
        'VALIDATION_FAILED',
      );
    });

    it('accepts the maximum quantity', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(
        orderBody(catalog, [{ productId: catalog.productId, quantity: 1_000_000 }]),
      );

      expect(response.status).toBe(201);
    });
  });

  describe('references', () => {
    it('rejects an unknown customer and names the field', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create({
        customerId: 987_654,
        lines: [{ productId: catalog.productId, quantity: 1 }],
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
      expect(response.body.details[0].field).toBe('customerId');
      expect(harness.connection.db.select().from(orders).all()).toHaveLength(0);
    });

    it('rejects an unknown product and names the field', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(
        orderBody(catalog, [{ productId: 987_654, quantity: 1 }]),
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
      expect(response.body.details[0].field).toBe('lines.productId');
    });

    it.each([
      ['fractional', 1.5],
      ['zero', 0],
      ['a string', 'abc'],
    ])('rejects a customer identifier that is %s', async (_name, customerId) => {
      const catalog = harness.catalog();
      await expectRejected(
        { customerId, lines: [{ productId: catalog.productId, quantity: 1 }] },
        'VALIDATION_FAILED',
      );
    });
  });

  it('rejects a body that is not an object', async () => {
    harness.catalog();
    const response = await api(harness).create([]);

    expect(response.status).toBe(400);
    expect(harness.connection.db.select().from(orders).all()).toHaveLength(0);
  });
});
