import { orderLineItems, orders } from '../../../src/database/schema';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/** User Story 4, and FR-072 to FR-077. */
describe('cancelling an order', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const createOrder = async (): Promise<number> => {
    const catalog = harness.catalog();
    const created = await api(harness).create(
      orderBody(catalog, [
        { productId: catalog.productId, quantity: 2 },
        { productId: catalog.otherProductId, quantity: 3 },
      ]),
    );
    expect(created.status).toBe(201);
    return created.body.id as number;
  };

  const setStatus = (id: number, status: string): void => {
    harness.connection.sqlite.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  };

  it('cancels a pending order', async () => {
    const id = await createOrder();
    const before = await api(harness).get(id);

    const response = await api(harness).cancel(id);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('cancelled');

    // FR-071: refreshed by the database, though the update statement named
    // neither timestamp. FR-024 from Spec 002: creation time is frozen.
    expect(response.body.updatedAtUs).toBeGreaterThan(before.body.updatedAtUs);
    expect(response.body.createdAtUs).toBe(before.body.createdAtUs);
  });

  it('reports the cancellation on subsequent reads', async () => {
    const id = await createOrder();
    await api(harness).cancel(id);

    const refetched = await api(harness).get(id);

    expect(refetched.body.status).toBe('cancelled');
  });

  /**
   * FR-075. Answering 200 would report a change that did not happen, and
   * deciding it would need the read-then-write guard Principle II forbids.
   */
  it('refuses to cancel an already cancelled order', async () => {
    const id = await createOrder();
    await api(harness).cancel(id);

    const response = await api(harness).cancel(id);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('TRANSITION_NOT_PERMITTED');
    expect(response.body.message).toContain('cancelled');
  });

  /** FR-074: the state machine's one business-meaningful refusal. */
  it('refuses to cancel an order that is already processing', async () => {
    const id = await createOrder();
    setStatus(id, 'processing');

    const response = await api(harness).cancel(id);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('TRANSITION_NOT_PERMITTED');
    expect(response.body.message).toContain('processing');
    expect(response.body.message).toContain('cancelled');

    const [row] = harness.connection.db.select().from(orders).all();
    expect(row!.status).toBe('processing');
  });

  /** FR-076: a missing order is 404, not the 409 a zero-row count would suggest. */
  it('reports a missing order as not found rather than as a conflict', async () => {
    harness.catalog();

    const response = await api(harness).cancel(987_654);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ORDER_NOT_FOUND');
  });

  it.each([
    ['non-numeric', 'abc'],
    ['zero', '0'],
    ['negative', '-3'],
  ])('rejects a %s identifier as malformed', async (_name, id) => {
    harness.catalog();
    const response = await api(harness).cancel(id);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  /**
   * FR-077 and Constitution Principle IV. Cancellation is the lifecycle's answer
   * to an unwanted order precisely because deletion is not available.
   */
  it('changes no line item and removes nothing', async () => {
    const id = await createOrder();
    const before = harness.connection.db.select().from(orderLineItems).all();

    await api(harness).cancel(id);

    const after = harness.connection.db.select().from(orderLineItems).all();
    expect(after).toEqual(before);
    expect(harness.connection.db.select().from(orders).all()).toHaveLength(1);
  });

  it('leaves the order total unchanged', async () => {
    const id = await createOrder();
    const before = await api(harness).get(id);

    const cancelled = await api(harness).cancel(id);

    expect(cancelled.body.totalMinor).toBe(before.body.totalMinor);
    expect(cancelled.body.lines).toEqual(before.body.lines);
  });

  /** FR-096 */
  it('records the transition with its outcome', async () => {
    const id = await createOrder();
    harness.clearLogs();

    await api(harness).cancel(id);
    await api(harness).cancel(id);

    const records = harness.records('order.transition');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ orderId: id, to: 'cancelled', outcome: 'applied' });
    expect(records[1]).toMatchObject({
      orderId: id,
      to: 'cancelled',
      from: 'cancelled',
      outcome: 'conflict',
    });
  });
});
