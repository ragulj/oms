import { orders } from '../../../src/database/schema';
import { applyTransition } from '../../../src/orders/order-transitions';
import { OrderPromotionTask } from '../../../src/scheduler/order-promotion.task';
import { StructuredLogger } from '../../../src/logging/logger';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/**
 * User Story 4, and FR-078, FR-079, FR-103.
 *
 * SQLite admits one writer and the driver is synchronous, so there is no
 * thread-level race to stage. The property under test is not that two threads
 * can be interleaved: it is that the *predicate* settles the race, so whichever
 * statement arrives second observes the first's effect through its changed-row
 * count. Both interleavings are driven from this process, which tests exactly
 * that and nothing it does not.
 */
describe('racing transitions on one order', () => {
  let harness: LifecycleHarness;
  let task: OrderPromotionTask;
  const silent = new StructuredLogger('error', () => {});

  beforeAll(async () => {
    harness = await createLifecycleHarness();
    task = harness.app.get(OrderPromotionTask, { strict: false });
  });

  afterAll(async () => {
    await harness.close();
  });

  const createOrder = async (): Promise<number> => {
    const catalog = harness.catalog();
    const created = await api(harness).create(orderBody(catalog));
    return created.body.id as number;
  };

  const statusOf = (id: number): string => {
    const row = harness.connection.db
      .select()
      .from(orders)
      .all()
      .find((candidate) => candidate.id === id);
    expect(row).toBeDefined();
    return row!.status;
  };

  /** FR-078, at the level the decision is actually made. */
  it('applies exactly one of two cancellations, decided by the changed-row count', async () => {
    const id = await createOrder();

    const first = applyTransition(harness.connection, silent, id, 'cancelled', {
      actor: 'request',
    });
    const second = applyTransition(harness.connection, silent, id, 'cancelled', {
      actor: 'request',
    });

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('conflict');
    expect(statusOf(id)).toBe('cancelled');
  });

  it('applies exactly one of two cancellations over HTTP', async () => {
    const id = await createOrder();

    const [a, b] = await Promise.all([api(harness).cancel(id), api(harness).cancel(id)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(statusOf(id)).toBe('cancelled');
  });

  /**
   * FR-079, first interleaving: the cancellation lands first. The job's outer
   * status predicate is what excludes the order, not a filter applied after
   * reading, which is why removing that predicate has to break this.
   */
  it('does not promote an order cancelled before the tick', async () => {
    const id = await createOrder();

    const cancelled = await api(harness).cancel(id);
    expect(cancelled.status).toBe(200);

    const result = task.runTick();

    expect(result.promoted).toBe(0);
    expect(statusOf(id)).toBe('cancelled');
  });

  /** FR-079, second interleaving: the promotion lands first, so cancellation is late. */
  it('refuses to cancel an order promoted before the request', async () => {
    const id = await createOrder();

    const result = task.runTick();
    expect(result.promoted).toBe(1);

    const cancelled = await api(harness).cancel(id);

    expect(cancelled.status).toBe(409);
    expect(statusOf(id)).toBe('processing');
  });

  /**
   * The property both interleavings share, stated directly: the order ends in
   * exactly one of the two statuses, never both applied and never neither.
   */
  it('leaves the order in exactly one status whichever arrives first', async () => {
    for (const cancelFirst of [true, false]) {
      const id = await createOrder();

      if (cancelFirst) {
        await api(harness).cancel(id);
        task.runTick();
      } else {
        task.runTick();
        await api(harness).cancel(id);
      }

      const status = statusOf(id);
      expect(['cancelled', 'processing']).toContain(status);
      expect(status).toBe(cancelFirst ? 'cancelled' : 'processing');
    }
  });

  /**
   * A cancellation cannot be retried into success. Constitution Principle II
   * names this specifically, because retrying a zero-row count until it reports
   * one is how a lost race becomes a reported success.
   */
  it('never turns a conflict into a success by repeating it', async () => {
    const id = await createOrder();
    task.runTick();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await api(harness).cancel(id);
      expect(response.status).toBe(409);
    }

    expect(statusOf(id)).toBe('processing');
  });
});
