import { idempotencyRecords, orders } from '../../../src/database/schema';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

const KEY = 'retry-key-00000001';

/**
 * User Story 1, and FR-028 to FR-035.
 *
 * This matters more here than in most systems. Constitution Principle IV makes a
 * stored order permanent: a duplicate created by a network retry can never be
 * deleted, only cancelled. Refusing it at the door is the only remedy available.
 */
describe('idempotent creation', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const storedOrderCount = () => harness.connection.db.select().from(orders).all().length;

  it('returns the original order and creates no second one', async () => {
    const catalog = harness.catalog();
    const body = orderBody(catalog);

    const first = await api(harness).create(body, { 'Idempotency-Key': KEY });
    const second = await api(harness).create(body, { 'Idempotency-Key': KEY });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(storedOrderCount()).toBe(1);
  });

  /** FR-030a: two byte-different serialisations of the same request are the same request. */
  it('treats a reordered body as the same request', async () => {
    const catalog = harness.catalog();

    const first = await api(harness).create(
      { customerId: catalog.customerId, lines: [{ productId: catalog.productId, quantity: 3 }] },
      { 'Idempotency-Key': KEY },
    );
    const second = await api(harness).create(
      { lines: [{ quantity: 3, productId: catalog.productId }], customerId: catalog.customerId },
      { 'Idempotency-Key': KEY },
    );

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(storedOrderCount()).toBe(1);
  });

  /** FR-033: answering with the earlier order would answer a question nobody asked. */
  it('refuses the same key with a different request', async () => {
    const catalog = harness.catalog();

    await api(harness).create(orderBody(catalog, [{ productId: catalog.productId, quantity: 3 }]), {
      'Idempotency-Key': KEY,
    });
    const conflicting = await api(harness).create(
      orderBody(catalog, [{ productId: catalog.productId, quantity: 9 }]),
      { 'Idempotency-Key': KEY },
    );

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(storedOrderCount()).toBe(1);
  });

  /**
   * An empty header is malformed rather than absent, on purpose. A caller that
   * sent the header meant to be protected, so silently ignoring an empty value
   * would create exactly the unprotected duplicate the header exists to prevent.
   */
  it.each([
    ['too short', 'abc'],
    ['containing a space', 'has a space'],
    ['containing a slash', 'has/slash'],
    ['empty', ''],
    ['too long', 'x'.repeat(256)],
  ])('rejects a key that is %s', async (_name, key) => {
    const catalog = harness.catalog();
    const response = await api(harness).create(orderBody(catalog), { 'Idempotency-Key': key });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(storedOrderCount()).toBe(0);
  });

  /** FR-029: stated plainly, because opt-in protection that looks automatic is worse than none. */
  it('applies no protection when no key is supplied', async () => {
    const catalog = harness.catalog();
    const body = orderBody(catalog);

    const first = await api(harness).create(body);
    const second = await api(harness).create(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(storedOrderCount()).toBe(2);
  });

  /** FR-031: a key recorded for an order that was not created would block a legitimate retry. */
  it('records no key when the request fails', async () => {
    const catalog = harness.catalog();

    const failed = await api(harness).create(
      orderBody(catalog, [{ productId: 987_654, quantity: 1 }]),
      { 'Idempotency-Key': KEY },
    );
    expect(failed.status).toBe(400);
    expect(harness.connection.db.select().from(idempotencyRecords).all()).toHaveLength(0);

    // And the same key still works afterwards, which is the point.
    const retried = await api(harness).create(orderBody(catalog), { 'Idempotency-Key': KEY });
    expect(retried.status).toBe(201);
  });

  /**
   * FR-034. The guarantee is the unique constraint, not the lookup that precedes
   * it. Removing the constraint has to break something, so this drives the write
   * that the lookup cannot see: a record inserted directly, as a racing request
   * would have done between the read and the write.
   */
  it('resolves a race through the database constraint, not through the read', async () => {
    const catalog = harness.catalog();

    const winner = await api(harness).create(orderBody(catalog), { 'Idempotency-Key': KEY });
    expect(winner.status).toBe(201);

    expect(() =>
      harness.connection.sqlite
        .prepare(
          `INSERT INTO idempotency_records (idempotency_key, request_fingerprint, order_id, created_at_us)
           VALUES (?, ?, ?, ?)`,
        )
        .run(KEY, 'a-different-fingerprint', winner.body.id, Date.now() * 1000),
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));

    expect(harness.connection.db.select().from(idempotencyRecords).all()).toHaveLength(1);
  });

  /** FR-035: expiry can be added later without a schema change only if this is here now. */
  it('stamps each record with a microsecond timestamp', async () => {
    const catalog = harness.catalog();
    const before = Date.now() * 1000;

    await api(harness).create(orderBody(catalog), { 'Idempotency-Key': KEY });

    const [record] = harness.connection.db.select().from(idempotencyRecords).all();

    expect(record).toBeDefined();
    expect(Number.isSafeInteger(record!.createdAtUs)).toBe(true);
    expect(record!.createdAtUs).toBeGreaterThanOrEqual(before);
  });
});
