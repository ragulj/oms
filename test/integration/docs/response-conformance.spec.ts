import request from 'supertest';
import type { ZodType } from 'zod';
import { MAX_MINOR_UNITS, products } from '../../../src/database/schema';
import {
  errorBodySchema,
  healthReportSchema,
  listOrdersResponseSchema,
  orderViewSchema,
} from '../../../src/docs/openapi.schemas';
import { api, orderBody } from '../../support/http-fixtures';
import { createDocsHarness, type DocsHarness, type JsonRecord } from '../../support/docs-fixtures';
import { createTestApp } from '../../setup/test-app';

/**
 * FR-009, FR-012, FR-031, FR-036. Every response the service produces is parsed
 * through the strict schema that generated its documented component.
 *
 * This is the whole justification for describing responses twice. `OrderView`
 * and its siblings are TypeScript interfaces, erased at runtime, so the
 * documented component cannot be derived from them the way a request component
 * is derived from its validation schema. The second description is permitted
 * only because it is executed against the first: every schema below is the one
 * published in `components.schemas`, and every object below came off the wire.
 *
 * The strictness is the point in both directions. `z.strictObject` rejects a
 * property the document does not describe, and a required property rejects a
 * documented field the response omits. A response that quietly gains a field
 * fails here rather than being discovered by a consumer.
 */
describe('every real response conforms to its documented schema', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Reports the schema's own message, which names the offending path. */
  const conforms = (schema: ZodType, body: unknown, what: string): void => {
    const result = schema.safeParse(body);
    expect(`${what}: ${result.success ? 'conforms' : JSON.stringify(result.error?.issues)}`).toBe(
      `${what}: conforms`,
    );
  };

  describe('success bodies (FR-009, FR-012)', () => {
    it('createOrder 201 is an OrderView', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(orderBody(catalog));

      expect(response.status).toBe(201);
      conforms(orderViewSchema, response.body, 'createOrder 201');
    });

    it('createOrder 200 replay is an OrderView', async () => {
      const catalog = harness.catalog();
      const body = orderBody(catalog);
      const key = 'conformance-replay-key';

      await api(harness).create(body, { 'Idempotency-Key': key });
      const replay = await api(harness).create(body, { 'Idempotency-Key': key });

      expect(replay.status).toBe(200);
      conforms(orderViewSchema, replay.body, 'createOrder 200');
    });

    it('getOrder 200 is an OrderView', async () => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));
      const response = await api(harness).get(created.body.id);

      expect(response.status).toBe(200);
      conforms(orderViewSchema, response.body, 'getOrder 200');
    });

    it('cancelOrder 200 is an OrderView', async () => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));
      const response = await api(harness).cancel(created.body.id);

      expect(response.status).toBe(200);
      conforms(orderViewSchema, response.body, 'cancelOrder 200');
    });

    it('listOrders 200 is a ListOrdersResponse, populated and empty alike', async () => {
      const empty = await api(harness).list();
      expect(empty.status).toBe(200);
      expect(empty.body.orders).toEqual([]);
      conforms(listOrdersResponseSchema, empty.body, 'listOrders 200 empty');

      const catalog = harness.catalog();
      await api(harness).create(orderBody(catalog));
      await api(harness).create(orderBody(catalog));

      const populated = await api(harness).list();
      expect(populated.status).toBe(200);
      conforms(listOrdersResponseSchema, populated.body, 'listOrders 200 populated');
    });

    it('listOrders carries a usable cursor on a partial page and null on the last', async () => {
      const catalog = harness.catalog();
      await api(harness).create(orderBody(catalog));
      await api(harness).create(orderBody(catalog));

      const first = await api(harness).list('?limit=1');
      conforms(listOrdersResponseSchema, first.body, 'listOrders 200 first page');
      expect(first.body.nextCursor).toEqual(expect.any(String));

      const second = await api(harness).list(
        `?limit=1&cursor=${encodeURIComponent(String(first.body.nextCursor))}`,
      );
      conforms(listOrdersResponseSchema, second.body, 'listOrders 200 second page');
    });
  });

  /**
   * T049. A failure body is the response a consumer handles under pressure, and
   * it is the one nobody looks at while it is working. Each documented failure
   * is provoked and parsed, so `ErrorBody` describes what is actually sent.
   */
  describe('failure bodies (FR-031, FR-036)', () => {
    it('a validation failure carries per-field detail', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(
        orderBody(catalog, [{ productId: catalog.productId, quantity: 0 }]),
      );

      expect(response.status).toBe(400);
      conforms(errorBodySchema, response.body, 'createOrder 400 VALIDATION_FAILED');
      expect(response.body.details.length).toBeGreaterThan(0);
      for (const detail of response.body.details) {
        expect(Object.keys(detail).sort()).toEqual(['field', 'message']);
      }
    });

    it('a state failure carries an empty detail list (FR-036)', async () => {
      const response = await api(harness).get(999_999);

      expect(response.status).toBe(404);
      conforms(errorBodySchema, response.body, 'getOrder 404');
      expect(response.body.details).toEqual([]);
    });

    /**
     * FR-036. Which codes carry detail is a published claim, and the document
     * originally got it wrong: it said detail accompanies a validation failure
     * and nothing else, while four other codes carry it and two of those name a
     * header or a query parameter rather than a body field.
     *
     * The suite did not catch that, because every case above asserted only that
     * a body parses and that one specific code has empty detail. Walking the
     * quickstart against a running service did. This case is the generalisation:
     * every code is provoked and its detail list compared against what the
     * published `ErrorBody` description promises for it, so the two cannot
     * disagree again without failing here.
     */
    it('carries detail for exactly the codes the document says it does (FR-036)', async () => {
      const catalog = harness.catalog();
      const key = 'detail-inventory-key';
      const created = await api(harness).create(orderBody(catalog));
      await api(harness).cancel(created.body.id);
      await api(harness).create(orderBody(catalog), { 'Idempotency-Key': key });

      const provoke: Record<string, () => Promise<{ body: { details: unknown[] } }>> = {
        VALIDATION_FAILED: () => api(harness).list('?limit=101'),
        CUSTOMER_NOT_FOUND: () =>
          api(harness).create({
            customerId: 999_999,
            lines: [{ productId: catalog.productId, quantity: 1 }],
          }),
        PRODUCT_NOT_FOUND: () =>
          api(harness).create(orderBody(catalog, [{ productId: 999_999, quantity: 1 }])),
        INVALID_CURSOR: () => api(harness).list('?cursor=not-a-real-cursor'),
        INVALID_IDEMPOTENCY_KEY: () =>
          api(harness).create(orderBody(catalog), { 'Idempotency-Key': 'short' }),
        ORDER_NOT_FOUND: () => api(harness).get(999_999),
        TRANSITION_NOT_PERMITTED: () => api(harness).cancel(created.body.id),
        IDEMPOTENCY_KEY_REUSED: () =>
          api(harness).create(orderBody(catalog, [{ productId: catalog.productId, quantity: 7 }]), {
            'Idempotency-Key': key,
          }),
      };

      const documented = String(
        (
          ((harness.document.components?.schemas?.ErrorBody as JsonRecord).properties as JsonRecord)
            .details as JsonRecord
        ).description,
      );

      for (const [code, provokeIt] of Object.entries(provoke)) {
        const response = await provokeIt();
        const observed = response.body.details.length > 0 ? 'carries detail' : 'empty';

        // The document names each code on one side of the sentence or the other,
        // so the claim is read from the published text rather than restated here.
        const promisedEmpty = documented.slice(documented.indexOf('Empty for')).includes(code);
        const promised = promisedEmpty ? 'empty' : 'carries detail';

        expect(`${code}: ${observed}`).toBe(`${code}: ${promised}`);
      }
    });

    it.each([
      ['createOrder 400 CUSTOMER_NOT_FOUND', 'CUSTOMER_NOT_FOUND'],
      ['createOrder 400 PRODUCT_NOT_FOUND', 'PRODUCT_NOT_FOUND'],
    ])('%s conforms', async (label, code) => {
      const catalog = harness.catalog();
      const body =
        code === 'CUSTOMER_NOT_FOUND'
          ? { customerId: 999_999, lines: [{ productId: catalog.productId, quantity: 1 }] }
          : orderBody(catalog, [{ productId: 999_999, quantity: 1 }]);

      const response = await api(harness).create(body);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(code);
      conforms(errorBodySchema, response.body, label);
    });

    it('an unrepresentable total conforms', async () => {
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

      expect(response.body.code).toBe('ORDER_TOTAL_NOT_REPRESENTABLE');
      conforms(errorBodySchema, response.body, 'createOrder 400 ORDER_TOTAL_NOT_REPRESENTABLE');
    });

    it('a malformed idempotency key conforms', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(orderBody(catalog), {
        'Idempotency-Key': 'short',
      });

      expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
      conforms(errorBodySchema, response.body, 'createOrder 400 INVALID_IDEMPOTENCY_KEY');
    });

    it('a reused idempotency key conforms', async () => {
      const catalog = harness.catalog();
      const key = 'conformance-reuse-key';

      await api(harness).create(orderBody(catalog), { 'Idempotency-Key': key });
      const response = await api(harness).create(
        orderBody(catalog, [{ productId: catalog.productId, quantity: 9 }]),
        { 'Idempotency-Key': key },
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      conforms(errorBodySchema, response.body, 'createOrder 409 IDEMPOTENCY_KEY_REUSED');
    });

    it('a malformed cursor conforms', async () => {
      const response = await api(harness).list('?cursor=not-a-real-cursor');

      expect(response.body.code).toBe('INVALID_CURSOR');
      conforms(errorBodySchema, response.body, 'listOrders 400 INVALID_CURSOR');
    });

    it('an illegal transition conforms', async () => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));
      await api(harness).cancel(created.body.id);

      const response = await api(harness).cancel(created.body.id);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('TRANSITION_NOT_PERMITTED');
      conforms(errorBodySchema, response.body, 'cancelOrder 409 TRANSITION_NOT_PERMITTED');
    });
  });

  /**
   * T049. The health report is not the shared error body, which is the whole
   * reason it is documented as its own component and checked separately here.
   */
  describe('the health report (FR-031)', () => {
    it('conforms when healthy', async () => {
      const response = await request(harness.server).get('/health');

      expect(response.status).toBe(200);
      conforms(healthReportSchema, response.body, 'checkHealth 200');
    });

    it('conforms when unhealthy, where the 503 body is a report and not an error', async () => {
      // Its own application: closing the connection to provoke the failure would
      // leave the shared harness unusable for every case above.
      const degraded = await createTestApp();
      try {
        degraded.connection.close();
        const response = await request(degraded.app.getHttpServer()).get('/health');

        expect(response.status).toBe(503);
        conforms(healthReportSchema, response.body, 'checkHealth 503');
        expect(errorBodySchema.safeParse(response.body).success).toBe(false);
      } finally {
        await degraded.close();
      }
    });
  });
});
