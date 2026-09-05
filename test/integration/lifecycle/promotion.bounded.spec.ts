import { OrderPromotionTask } from '../../../src/scheduler/order-promotion.task';
import { seedOrdersInStatus } from '../../support/order-fixtures';
import { createLifecycleHarness, type LifecycleHarness } from '../../support/http-fixtures';

/**
 * User Story 5, FR-084, FR-085, FR-087, and SC-005.
 *
 * The requirement here is the inverse of every other one in this system: the
 * tick is correct *because* it stops early. An implementation that drains the
 * whole backlog in one tick has failed these, not passed them.
 */
describe('a background tick is bounded', () => {
  const countByStatus = (harness: LifecycleHarness, status: string): number =>
    (
      harness.connection.sqlite
        .prepare('SELECT COUNT(*) AS n FROM orders WHERE status = ?')
        .get(status) as { n: number }
    ).n;

  describe('at the shipped defaults', () => {
    let harness: LifecycleHarness;
    let task: OrderPromotionTask;

    beforeAll(async () => {
      harness = await createLifecycleHarness();
      task = harness.app.get(OrderPromotionTask, { strict: false });
    });

    afterAll(async () => {
      await harness.close();
    });

    /** SC-005: 5,000 pending, chunk 100, cap 10, so exactly 1,000 move. */
    it('promotes exactly chunk times cap and leaves the rest pending', () => {
      seedOrdersInStatus(harness.connection, 5_000, 'pending');

      const result = task.runTick();

      expect(result.promoted).toBe(1_000);
      expect(result.iterations).toBe(10);
      expect(result.capReached).toBe(true);
      expect(countByStatus(harness, 'processing')).toBe(1_000);
      expect(countByStatus(harness, 'pending')).toBe(4_000);
    });

    /** The remainder is not lost: it drains across ticks rather than in one. */
    it('drains a backlog across successive ticks', () => {
      seedOrdersInStatus(harness.connection, 2_500, 'pending');

      const first = task.runTick();
      const second = task.runTick();
      const third = task.runTick();

      expect([first.promoted, second.promoted, third.promoted]).toEqual([1_000, 1_000, 500]);
      expect(third.capReached).toBe(false);
      expect(countByStatus(harness, 'pending')).toBe(0);
      expect(countByStatus(harness, 'processing')).toBe(2_500);
    });
  });

  describe('at a configured chunk size and cap', () => {
    let harness: LifecycleHarness;
    let task: OrderPromotionTask;

    beforeAll(async () => {
      harness = await createLifecycleHarness({
        ORDER_PROMOTION_CHUNK_SIZE: '10',
        ORDER_PROMOTION_MAX_ITERATIONS: '3',
      });
      task = harness.app.get(OrderPromotionTask, { strict: false });
    });

    afterAll(async () => {
      await harness.close();
    });

    /** FR-083, FR-084: both are configuration, and both actually take effect. */
    it('honours the configured bounds', () => {
      seedOrdersInStatus(harness.connection, 100, 'pending');

      const result = task.runTick();

      expect(result.promoted).toBe(30);
      expect(result.iterations).toBe(3);
      expect(result.capReached).toBe(true);
      expect(countByStatus(harness, 'pending')).toBe(70);
    });

    /** FR-085: a short backlog ends the tick early rather than spending the cap. */
    it('ends early when the backlog runs out', () => {
      seedOrdersInStatus(harness.connection, 5, 'pending');

      const result = task.runTick();

      expect(result.promoted).toBe(5);
      // One chunk of 5, then a zero-row claim that ends the tick, with the third
      // permitted iteration unspent.
      expect(result.iterations).toBe(2);
      expect(result.capReached).toBe(false);
      expect(countByStatus(harness, 'pending')).toBe(0);
    });

    it('ends after one claim when the backlog is empty', () => {
      const result = task.runTick();

      expect(result.promoted).toBe(0);
      expect(result.iterations).toBe(1);
      expect(result.capReached).toBe(false);
    });

    /** FR-089: oldest first, so a backlog cannot starve its own head. */
    it('promotes the oldest pending orders first', () => {
      const { orderIds } = seedOrdersInStatus(harness.connection, 50, 'pending');

      task.runTick();

      const promoted = (
        harness.connection.sqlite
          .prepare("SELECT id FROM orders WHERE status = 'processing' ORDER BY id")
          .all() as { id: number }[]
      ).map((row) => row.id);

      // seedOrdersInStatus writes strictly increasing creation timestamps, so the
      // oldest thirty are the first thirty identifiers.
      expect(promoted).toEqual(orderIds.slice(0, 30));
    });
  });
});
