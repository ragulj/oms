import request from 'supertest';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/** FR-004 to FR-008, and the shape recorded in contracts/http-api.md. */
describe('the shared HTTP contract', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('the error envelope', () => {
    it('has the same shape for every failure', async () => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));
      await api(harness).cancel(created.body.id);

      const failures = [
        await api(harness).get(987_654), // 404
        await api(harness).get('abc'), // 400 malformed identifier
        await api(harness).create({}), // 400 validation
        await api(harness).cancel(created.body.id), // 409 conflict
        await api(harness).list('?limit=999'), // 400 out of range
      ];

      for (const response of failures) {
        expect([400, 404, 409]).toContain(response.status);
        expect(Object.keys(response.body).sort()).toEqual([
          'code',
          'correlationId',
          'details',
          'message',
        ]);
        expect(typeof response.body.code).toBe('string');
        expect(typeof response.body.message).toBe('string');
        expect(Array.isArray(response.body.details)).toBe(true);
      }
    });

    /** FR-006: the message is the most likely carrier of something internal. */
    it('leaks no stack trace, driver message, SQL, or path', async () => {
      harness.catalog();

      const failures = [
        await api(harness).get('abc'),
        await api(harness).create({ customerId: 1, lines: [] }),
        await api(harness).list('?cursor=%25%25%25'),
        await api(harness).create({ customerId: 987_654, lines: [{ productId: 1, quantity: 1 }] }),
      ];

      for (const response of failures) {
        const body = JSON.stringify(response.body);
        expect(body).not.toMatch(/SQLITE_|SqliteError|better-sqlite3/i);
        expect(body).not.toMatch(/\bselect\b.*\bfrom\b/i);
        expect(body).not.toMatch(/[A-Za-z]:\\|\/node_modules\//);
        expect(body).not.toMatch(/\bat\s+\w+\s+\(/);
      }
    });

    it('names the offending field on a validation failure', async () => {
      const catalog = harness.catalog();

      const response = await api(harness).create({
        customerId: catalog.customerId,
        lines: [{ productId: catalog.productId, quantity: 0 }],
      });

      expect(response.status).toBe(400);
      expect(response.body.details.length).toBeGreaterThan(0);
      expect(response.body.details[0]).toEqual({
        field: expect.any(String),
        message: expect.any(String),
      });
    });
  });

  describe('correlation identifiers', () => {
    it('echoes a well-formed supplied identifier', async () => {
      const catalog = harness.catalog();

      const response = await api(harness).create(orderBody(catalog), {
        'X-Correlation-Id': 'caller-supplied-id-1',
      });

      expect(response.headers['x-correlation-id']).toBe('caller-supplied-id-1');
    });

    it('generates one when none is supplied', async () => {
      const catalog = harness.catalog();

      const response = await api(harness).create(orderBody(catalog));

      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('generates one rather than echoing a malformed value', async () => {
      const catalog = harness.catalog();

      const response = await api(harness).create(orderBody(catalog), {
        'X-Correlation-Id': 'no',
      });

      expect(response.headers['x-correlation-id']).not.toBe('no');
      expect(response.headers['x-correlation-id']).toHaveLength(36);
    });

    it('returns one on failures too, and puts it in the body', async () => {
      harness.catalog();

      const response = await api(harness)
        .get(987_654)
        .set('X-Correlation-Id', 'failure-correlation-1');

      expect(response.status).toBe(404);
      expect(response.headers['x-correlation-id']).toBe('failure-correlation-1');
      expect(response.body.correlationId).toBe('failure-correlation-1');
    });

    it('gives a different identifier to each request', async () => {
      const catalog = harness.catalog();

      const ids = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const response = await api(harness).create(orderBody(catalog));
          return response.headers['x-correlation-id'];
        }),
      );

      expect(new Set(ids).size).toBe(5);
    });
  });

  describe('the wire format', () => {
    /** FR-008: no decimal, no float, no formatted string on a money field. */
    it('carries money only as integers', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(orderBody(catalog));

      const money = [
        response.body.totalMinor,
        ...response.body.lines.map((line: { unitPriceMinor: number }) => line.unitPriceMinor),
        ...response.body.lines.map((line: { lineTotalMinor: number }) => line.lineTotalMinor),
      ];

      for (const value of money) {
        expect(Number.isSafeInteger(value)).toBe(true);
      }
      expect(JSON.stringify(response.body)).not.toMatch(/"[^"]*Minor":\s*"?\d+\.\d/);
    });

    it('serves order routes under the version prefix and health outside it', async () => {
      harness.catalog();

      expect((await api(harness).list()).status).toBe(200);
      expect((await request(harness.server).get('/health')).status).toBe(200);

      // Unversioned order routes must not exist.
      expect((await request(harness.server).get('/orders')).status).toBe(404);
      // And health must not be versioned.
      expect((await request(harness.server).get('/api/v1/health')).status).toBe(404);
    });
  });
});
