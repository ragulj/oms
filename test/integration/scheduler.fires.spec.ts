import { OrderPromotionTask } from '../../src/scheduler/order-promotion.task';
import { createTestApp, type TestHarness } from '../setup/test-app';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spec 001 User Story 6 scenario 1, carried forward to the real job.
 *
 * Spec 003 FR-081 replaced the heartbeat placeholder with the order promotion
 * task. This file was rewritten rather than deleted, so Spec 001's coverage that
 * recurring work registers and actually fires survives the replacement instead
 * of quietly disappearing with the placeholder it happened to name.
 *
 * The five-minute default exceeds the whole verification budget, so Spec 001
 * FR-029 requires the interval to be overridden through configuration rather
 * than waited on. Everything about what a tick *does* is asserted in
 * test/integration/lifecycle/, by invoking it directly.
 */
describe('the scheduled promotion task', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp({ SCHEDULER_INTERVAL_MS: '60' });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('executes on each elapsed interval and leaves observable evidence', async () => {
    const task = harness.app.get(OrderPromotionTask, { strict: false });

    await wait(400);

    expect(task.tickCount).toBeGreaterThanOrEqual(3);

    const ticks = harness.logLines
      .map((line) => JSON.parse(line) as { message: string; iterations?: number })
      .filter((record) => record.message === 'order.promotion.tick');

    expect(ticks.length).toBeGreaterThanOrEqual(3);

    // An empty backlog still performs one claim and then stops, rather than
    // spending the whole iteration cap on statements that match nothing.
    expect(ticks[0]?.iterations).toBe(1);
  });
});
