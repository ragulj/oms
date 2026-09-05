import { MAX_MINOR_UNITS, products } from '../../../src/database/schema';
import { api, orderBody } from '../../support/http-fixtures';
import {
  advertisedErrorCodes,
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';

/**
 * FR-077, SC-003. Every documented failure is provoked against the running
 * service, and the observed status and code are compared with the documented
 * ones.
 *
 * This is the file that makes the rest of the documentation credible. A document
 * can claim any failure it likes; only an executed request shows that the claim
 * is true. SC-003 carries no exemption, which is why FR-038 keeps the
 * unprovokable server-error response at document level: every failure named on
 * an operation below is one this file actually causes.
 */
describe('every documented failure actually happens', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** What the document promises for one operation: status paired with code. */
  const documented = (operationId: string): { status: number; code: string }[] => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!operation) throw new Error(`No operation documented with id ${operationId}.`);

    const responses = operation.operation.responses as Record<string, JsonRecord>;
    const pairs: { status: number; code: string }[] = [];
    for (const [status, response] of Object.entries(responses)) {
      const content = response.content as Record<string, JsonRecord> | undefined;
      const examples = content?.['application/json']?.examples as JsonRecord | undefined;
      for (const code of Object.keys(examples ?? {})) {
        pairs.push({ status: Number(status), code });
      }
    }
    return pairs;
  };

  const observed: { operationId: string; status: number; code: string }[] = [];

  const record = (operationId: string, status: number, code: string): void => {
    observed.push({ operationId, status, code });
  };

  it('createOrder: VALIDATION_FAILED on a quantity below the floor', async () => {
    const catalog = harness.catalog();
    const response = await api(harness).create(
      orderBody(catalog, [{ productId: catalog.productId, quantity: 0 }]),
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details.length).toBeGreaterThan(0);
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: VALIDATION_FAILED on an unknown property', async () => {
    const catalog = harness.catalog();
    const response = await api(harness).create({
      ...orderBody(catalog),
      unitPriceMinor: 1,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: CUSTOMER_NOT_FOUND on an unknown customer', async () => {
    const catalog = harness.catalog();
    const response = await api(harness).create({
      customerId: 999_999,
      lines: [{ productId: catalog.productId, quantity: 1 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: PRODUCT_NOT_FOUND on an unknown product', async () => {
    const catalog = harness.catalog();
    const response = await api(harness).create(
      orderBody(catalog, [{ productId: 999_999, quantity: 1 }]),
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: ORDER_TOTAL_NOT_REPRESENTABLE when the derived total overflows', async () => {
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
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: INVALID_IDEMPOTENCY_KEY on a malformed key', async () => {
    const catalog = harness.catalog();
    const response = await api(harness).create(orderBody(catalog), {
      'Idempotency-Key': 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    record('createOrder', response.status, response.body.code);
  });

  it('createOrder: IDEMPOTENCY_KEY_REUSED on the same key with a different body', async () => {
    const catalog = harness.catalog();
    const key = 'documented-key-001';

    const first = await api(harness).create(orderBody(catalog), { 'Idempotency-Key': key });
    expect(first.status).toBe(201);

    const second = await api(harness).create(
      orderBody(catalog, [{ productId: catalog.productId, quantity: 7 }]),
      { 'Idempotency-Key': key },
    );

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    record('createOrder', second.status, second.body.code);
  });

  it('getOrder: VALIDATION_FAILED on a non-numeric identifier', async () => {
    const response = await api(harness).get('not-a-number');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    record('getOrder', response.status, response.body.code);
  });

  it('getOrder: ORDER_NOT_FOUND on an identifier that matches nothing', async () => {
    const response = await api(harness).get(999_999);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ORDER_NOT_FOUND');
    record('getOrder', response.status, response.body.code);
  });

  it('listOrders: VALIDATION_FAILED on a page size above the maximum', async () => {
    const response = await api(harness).list('?limit=101');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    record('listOrders', response.status, response.body.code);
  });

  it('listOrders: VALIDATION_FAILED on an offset parameter', async () => {
    const response = await api(harness).list('?offset=10');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    record('listOrders', response.status, response.body.code);
  });

  it('listOrders: INVALID_CURSOR on a malformed cursor', async () => {
    const response = await api(harness).list('?cursor=not-a-real-cursor');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_CURSOR');
    record('listOrders', response.status, response.body.code);
  });

  it('cancelOrder: VALIDATION_FAILED on a non-numeric identifier', async () => {
    const response = await api(harness).cancel('nope');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    record('cancelOrder', response.status, response.body.code);
  });

  it('cancelOrder: ORDER_NOT_FOUND on an identifier that matches nothing', async () => {
    const response = await api(harness).cancel(999_999);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ORDER_NOT_FOUND');
    record('cancelOrder', response.status, response.body.code);
  });

  it('cancelOrder: TRANSITION_NOT_PERMITTED on a second cancellation', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(orderBody(catalog));
    expect(created.status).toBe(201);

    expect((await api(harness).cancel(created.body.id)).status).toBe(200);

    const repeat = await api(harness).cancel(created.body.id);
    expect(repeat.status).toBe(409);
    expect(repeat.body.code).toBe('TRANSITION_NOT_PERMITTED');
    record('cancelOrder', repeat.status, repeat.body.code);
  });

  /**
   * Runs last, and is the assertion SC-003 actually measures. The individual
   * cases above could each pass while the document promised a failure nobody
   * exercised; this compares the two sets.
   */
  it('leaves no documented failure unexercised (SC-003)', () => {
    for (const operationId of ['createOrder', 'getOrder', 'listOrders', 'cancelOrder']) {
      const promised = documented(operationId)
        .map((pair) => `${pair.status} ${pair.code}`)
        .sort();
      const exercised = [
        ...new Set(
          observed
            .filter((entry) => entry.operationId === operationId)
            .map((entry) => `${entry.status} ${entry.code}`),
        ),
      ].sort();

      expect({ operationId, exercised }).toEqual({
        operationId,
        exercised: [...new Set(promised)].sort(),
      });
    }
  });

  it('advertises a code for every failure response it documents', () => {
    for (const operation of documentedOperations(harness.document)) {
      if (operation.path === '/health') continue;
      const failureStatuses = Object.keys(operation.operation.responses as JsonRecord).filter(
        (status) => Number(status) >= 400,
      );
      if (failureStatuses.length === 0) continue;
      expect(advertisedErrorCodes(operation.operation).length).toBeGreaterThan(0);
    }
  });
});
