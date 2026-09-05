import { OrderPromotionTask } from '../../../src/scheduler/order-promotion.task';
import { OverlapGuard } from '../../../src/scheduler/overlap-guard';
import { drain } from '../../../src/lifecycle/shutdown';
import { seedOrdersInStatus } from '../../support/order-fixtures';
import { createLifecycleHarness, type LifecycleHarness } from '../../support/http-fixtures';

/** User Story 5, and FR-091, FR-092, FR-094, FR-097. */
describe('the promotion tick lifecycle', () => {
  let harness: LifecycleHarness;
  let task: OrderPromotionTask;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
    task = harness.app.get(OrderPromotionTask, { strict: false });
  });

  afterAll(async () => {
    await harness.close();
  });

  /** FR-097: the record an operator reads to know whether the backlog is keeping up. */
  it('records what each tick did', () => {
    seedOrdersInStatus(harness.connection, 150, 'pending');
    harness.clearLogs();

    task.runTick();

    const [record] = harness.records('order.promotion.tick');

    // 100, then 50, then a zero-row claim that ends the tick.
    expect(record).toMatchObject({
      task: 'order-promotion',
      iterations: 3,
      promoted: 150,
      capReached: false,
    });
    expect(typeof record!.durationMs).toBe('number');
  });

  it('reports the cap being reached, so a lagging backlog is visible', () => {
    seedOrdersInStatus(harness.connection, 2_000, 'pending');
    harness.clearLogs();

    task.runTick();

    const [record] = harness.records('order.promotion.tick');
    expect(record).toMatchObject({ promoted: 1_000, iterations: 10, capReached: true });
  });

  /**
   * FR-091. @nestjs/schedule does not prevent overlapping executions on its own,
   * so this is the guard doing what Spec 001 introduced it for, now protecting
   * real work rather than a placeholder.
   */
  it('skips a tick while the previous one is still running, and records the skip', async () => {
    const guard = harness.app.get(OverlapGuard, { strict: false });
    harness.clearLogs();

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = guard.run(() => blocked);
    await Promise.resolve();

    await task.tick();

    const [skip] = harness.records('order.promotion.skipped');
    expect(skip).toMatchObject({ task: 'order-promotion', reason: 'skipped-overlap' });

    release();
    await inFlight;
  });

  /** FR-092: no new tick once shutdown starts. */
  it('starts no tick after shutdown has begun', async () => {
    const shuttingDown = await createLifecycleHarness();
    const shuttingDownTask = shuttingDown.app.get(OrderPromotionTask, { strict: false });
    seedOrdersInStatus(shuttingDown.connection, 20, 'pending');

    await drain({
      guard: shuttingDown.app.get(OverlapGuard, { strict: false }),
      close: async () => undefined,
      timeoutMs: 1_000,
    });
    shuttingDown.clearLogs();

    await shuttingDownTask.tick();

    const [skip] = shuttingDown.records('order.promotion.skipped');
    expect(skip).toMatchObject({ reason: 'skipped-shutdown' });

    const pending = (
      shuttingDown.connection.sqlite
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'")
        .get() as { n: number }
    ).n;
    expect(pending).toBe(20);

    await shuttingDown.close();
  });

  /**
   * FR-094. A failure part-way through a tick must leave committed chunks
   * committed and end the tick, rather than rolling back completed work or
   * taking the process down. The failure is staged by removing the table the
   * claim writes to, which is the bluntest way to make the next chunk throw.
   */
  it('keeps committed chunks and ends the tick when a chunk fails', async () => {
    const failing = await createLifecycleHarness({
      ORDER_PROMOTION_CHUNK_SIZE: '10',
      ORDER_PROMOTION_MAX_ITERATIONS: '10',
    });
    const failingTask = failing.app.get(OrderPromotionTask, { strict: false });
    seedOrdersInStatus(failing.connection, 100, 'pending');

    // One successful chunk first, so there is committed work to protect.
    const before = failingTask.runTick();
    expect(before.promoted).toBe(100);

    seedOrdersInStatus(failing.connection, 50, 'pending', 1_800_000_000_000_000);
    failing.connection.sqlite.exec('ALTER TABLE orders RENAME TO orders_hidden');
    failing.clearLogs();

    let result: ReturnType<OrderPromotionTask['runTick']>;
    expect(() => {
      result = failingTask.runTick();
    }).not.toThrow();

    const [record] = failing.records('order.promotion.failed');
    expect(record).toMatchObject({ task: 'order-promotion' });
    expect(result!.promoted).toBe(0);

    failing.connection.sqlite.exec('ALTER TABLE orders_hidden RENAME TO orders');

    // The earlier chunk's work survived the later failure.
    const promoted = (
      failing.connection.sqlite
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'processing'")
        .get() as { n: number }
    ).n;
    expect(promoted).toBe(100);

    await failing.close();
  });

  /** FR-104: behaviour is observed by invoking a tick, never by waiting for one. */
  it('is directly invocable without waiting for the schedule', () => {
    seedOrdersInStatus(harness.connection, 5, 'pending');

    const startedAt = Date.now();
    const result = task.runTick();

    expect(result.promoted).toBe(5);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
