import request from 'supertest';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/** FR-001, FR-056a, FR-064, FR-098, FR-099, FR-100. */
describe('observability and the route surface', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('failure records', () => {
    /** FR-098: a caller's fault is a warning; an unexpected fault would be an error. */
    it('records a client fault at warning level with the route and the code', async () => {
      harness.catalog();
      harness.clearLogs();

      await api(harness).get(987_654).set('X-Correlation-Id', 'observability-404');

      const [record] = harness.records('request.failed');

      expect(record).toMatchObject({
        level: 'warn',
        correlationId: 'observability-404',
        method: 'GET',
        status: 404,
        code: 'ORDER_NOT_FOUND',
      });
      expect(record!.route).toContain('/orders/987654');
    });

    it('records every rejected request', async () => {
      harness.catalog();
      harness.clearLogs();

      await api(harness).get('abc');
      await api(harness).create({});
      await api(harness).list('?limit=0');

      const records = harness.records('request.failed');
      expect(records).toHaveLength(3);
      expect(records.every((record) => record.level === 'warn')).toBe(true);
    });

    it('records nothing for a successful request', async () => {
      const catalog = harness.catalog();
      harness.clearLogs();

      const created = await api(harness).create(orderBody(catalog));
      expect(created.status).toBe(201);

      expect(harness.records('request.failed')).toHaveLength(0);
    });

    /**
     * FR-100. A record carrying the whole body would put customer data and every
     * header into the log, which is the opposite of what the existing redaction
     * is for.
     */
    it('carries neither a full request body nor a full header set', async () => {
      const catalog = harness.catalog();
      harness.clearLogs();

      await api(harness)
        .create({ customerId: catalog.customerId, lines: [], secretish: 'do-not-log-me' })
        .set('Authorization', 'Bearer should-not-appear');

      const [record] = harness.records('request.failed');
      const serialised = JSON.stringify(record);

      expect(serialised).not.toContain('do-not-log-me');
      expect(serialised).not.toContain('should-not-appear');
      expect(record).not.toHaveProperty('body');
      expect(record).not.toHaveProperty('headers');
    });
  });

  /** FR-099: one parseable line per record, in every environment. */
  it('emits every record as a single line of parseable JSON', async () => {
    const catalog = harness.catalog();
    harness.clearLogs();

    await api(harness).create(orderBody(catalog));
    await api(harness).get(987_654);

    expect(harness.logLines.length).toBeGreaterThan(0);
    for (const line of harness.logLines) {
      expect(line).not.toContain('\n');
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(typeof parsed.timestamp).toBe('string');
      expect(typeof parsed.level).toBe('string');
      expect(typeof parsed.message).toBe('string');
    }
  });

  /**
   * FR-064 and FR-079. There is no path that sets an arbitrary status, and no way
   * to modify or remove a stored order. Constitution Principle IV makes an order
   * permanent, so these absences are the contract rather than an oversight.
   */
  describe('the route surface offers nothing beyond the contract', () => {
    it.each([
      ['PATCH an order', 'patch', '/api/v1/orders/1'],
      ['PUT an order', 'put', '/api/v1/orders/1'],
      ['DELETE an order', 'delete', '/api/v1/orders/1'],
      ['DELETE the collection', 'delete', '/api/v1/orders'],
      ['set a status directly', 'post', '/api/v1/orders/1/status'],
      ['promote through the API', 'post', '/api/v1/orders/1/process'],
      ['delete a line item', 'delete', '/api/v1/orders/1/lines/1'],
    ])('offers no way to %s', async (_name, method, path) => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));
      expect(created.status).toBe(201);

      const agent = request(harness.server) as unknown as Record<
        string,
        (url: string) => request.Test
      >;
      const response = await agent[method]!(path.replace('/1', `/${created.body.id}`)).send({
        status: 'processing',
      });

      expect(response.status).toBe(404);
    });

    /**
     * FR-056a. Spec 002 left `orders.customer_id` deliberately unindexed under
     * its FR-039a, so a customer filter would scan the table behind an
     * index-shaped API. Adding one requires adding the index first.
     */
    it('offers no customer filter on the listing', async () => {
      const catalog = harness.catalog();
      await api(harness).create(orderBody(catalog));

      const response = await api(harness).list(`?customerId=${catalog.customerId}`);

      expect(response.status).toBe(400);
    });
  });
});
