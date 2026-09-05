import { OrderPromotionTask } from '../../../src/scheduler/order-promotion.task';
import { seedOrdersInStatus } from '../../support/order-fixtures';
import { createLifecycleHarness, type LifecycleHarness } from '../../support/http-fixtures';

/**
 * Spec 005. When a tick stops, and why.
 *
 * Every assertion here reads `iterations` — the number of claims the tick
 * actually performed. That is deliberate and is the whole reason this file
 * exists: the defect being fixed is **invisible in every other outcome**. The
 * same orders are promoted, in the same order, leaving the same rows behind,
 * before and after the change. A test that asserted only on promoted counts
 * would pass identically against the defect and against the fix, which is
 * exactly how the extra claim survived Spec 003's suite.
 *
 * The rule under test: a tick claims batches until one comes back smaller than
 * the chunk size, or until the iteration cap stops it, whichever happens first.
 */
describe('when a promotion tick stops claiming', () => {
  const CHUNK = 10;
  const CAP = 5;

  let harness: LifecycleHarness;
  let task: OrderPromotionTask;

  beforeAll(async () => {
    harness = await createLifecycleHarness({
      ORDER_PROMOTION_CHUNK_SIZE: String(CHUNK),
      ORDER_PROMOTION_MAX_ITERATIONS: String(CAP),
    });
    task = harness.app.get(OrderPromotionTask, { strict: false });
  });

  afterAll(async () => {
    await harness.close();
  });

  const pendingCount = (): number =>
    (
      harness.connection.sqlite
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'")
        .get() as { n: number }
    ).n;

  describe('because the work ran out (User Story 1)', () => {
    it('costs exactly one claim against an empty backlog', () => {
      const result = task.runTick();

      // One is the floor, not an inefficiency: a tick cannot know the queue is
      // empty without asking once.
      expect(result.iterations).toBe(1);
      expect(result.promoted).toBe(0);
      expect(result.capReached).toBe(false);
      expect(result.stopReason).toBe('drained');
    });

    it('costs exactly one claim against a backlog smaller than one chunk', () => {
      seedOrdersInStatus(harness.connection, CHUNK - 5, 'pending');

      const result = task.runTick();

      // The defect this feature removes: a second claim used to run here, purely
      // to be told what the first claim had already proved.
      expect(result.iterations).toBe(1);
      expect(result.promoted).toBe(CHUNK - 5);
      expect(result.capReached).toBe(false);
      expect(result.stopReason).toBe('drained');
      expect(pendingCount()).toBe(0);
    });

    it('costs two claims against a backlog of exactly one chunk', () => {
      seedOrdersInStatus(harness.connection, CHUNK, 'pending');

      const result = task.runTick();

      // A full chunk is evidence of nothing. The backlog might hold exactly one
      // more, so the tick must ask again. This is the boundary that makes the
      // comparison `claimed < chunkSize` rather than `<=`; the other way round
      // would strand a full chunk of work on every tick.
      expect(result.iterations).toBe(2);
      expect(result.promoted).toBe(CHUNK);
      expect(result.stopReason).toBe('drained');
      expect(pendingCount()).toBe(0);
    });

    it('ends on the short claim, not the empty one, for a partial final chunk', () => {
      seedOrdersInStatus(harness.connection, CHUNK * 2 + 3, 'pending');

      const result = task.runTick();

      // Two full chunks and one short. Before this change there was a fourth
      // claim returning nothing.
      expect(result.iterations).toBe(3);
      expect(result.promoted).toBe(CHUNK * 2 + 3);
      expect(result.stopReason).toBe('drained');
      expect(pendingCount()).toBe(0);
    });
  });

  describe('because the safety guard stopped it (User Story 2)', () => {
    it('performs exactly the cap and leaves the remainder pending', () => {
      seedOrdersInStatus(harness.connection, CHUNK * CAP * 3, 'pending');

      const result = task.runTick();

      expect(result.iterations).toBe(CAP);
      expect(result.promoted).toBe(CHUNK * CAP);
      expect(result.capReached).toBe(true);
      expect(result.stopReason).toBe('guard');
      expect(pendingCount()).toBe(CHUNK * CAP * 3 - CHUNK * CAP);
    });

    it('reports the guard on a backlog of exactly chunk times cap, which is drained', () => {
      seedOrdersInStatus(harness.connection, CHUNK * CAP, 'pending');

      const result = task.runTick();

      // Correct rather than a defect. Every claim came back full, so no short
      // claim ever happened and the guard is genuinely what ended the tick.
      // Reporting `drained` would require knowing the queue is empty, which costs
      // the very claim this feature removes. The next tick finds nothing and
      // costs one claim (research R5).
      expect(result.iterations).toBe(CAP);
      expect(result.promoted).toBe(CHUNK * CAP);
      expect(result.capReached).toBe(true);
      expect(result.stopReason).toBe('guard');
      expect(pendingCount()).toBe(0);

      const next = task.runTick();
      expect(next.iterations).toBe(1);
      expect(next.promoted).toBe(0);
      expect(next.stopReason).toBe('drained');
    });

    it('never exceeds the cap even when the backlog is refilled before every claim', () => {
      // The case that separates a loop with a guard from a loop that merely
      // happens to finish. Every claim finds a full chunk waiting, so no claim is
      // ever short and nothing but the guard can end this tick.
      seedOrdersInStatus(harness.connection, CHUNK * CAP * 10, 'pending');

      const result = task.runTick();

      expect(result.iterations).toBe(CAP);
      expect(result.iterations).toBeLessThanOrEqual(CAP);
      expect(result.stopReason).toBe('guard');
      expect(pendingCount()).toBeGreaterThan(0);
    });

    it('performs exactly one claim when the cap is configured to one', async () => {
      // The smallest setting the guard has, where an off-by-one is invisible at
      // the default of ten.
      const tight = await createLifecycleHarness({
        ORDER_PROMOTION_CHUNK_SIZE: String(CHUNK),
        ORDER_PROMOTION_MAX_ITERATIONS: '1',
      });
      try {
        seedOrdersInStatus(tight.connection, CHUNK * 20, 'pending');
        const tightTask = tight.app.get(OrderPromotionTask, { strict: false });

        const result = tightTask.runTick();

        expect(result.iterations).toBe(1);
        expect(result.promoted).toBe(CHUNK);
        expect(result.capReached).toBe(true);
        expect(result.stopReason).toBe('guard');
      } finally {
        await tight.close();
      }
    });
  });

  /**
   * contracts/scheduler-tick.md states the rule as a table of backlog shapes.
   * Walking it wholesale covers the shapes nobody thought to name individually,
   * and would catch an implementation that special-cased the examples above.
   */
  describe('across the whole termination table (contract)', () => {
    /**
     * One claim per full chunk, plus the claim that comes back short and ends
     * the tick, bounded by the cap. A backlog that divides exactly into chunks
     * is not a special case: its final short claim is the one returning zero.
     */
    const expectedClaims = (backlog: number): number =>
      Math.min(Math.floor(backlog / CHUNK) + 1, CAP);

    const cases = [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2, CHUNK * 3 + 7, CHUNK * CAP];

    it.each(cases)('a backlog of %i behaves as the contract says', (backlog) => {
      if (backlog > 0) seedOrdersInStatus(harness.connection, backlog, 'pending');

      const result = task.runTick();

      const claims = expectedClaims(backlog);
      expect({ backlog, iterations: result.iterations }).toEqual({
        backlog,
        iterations: claims,
      });
      expect(result.promoted).toBe(Math.min(backlog, CHUNK * CAP));
      expect(result.capReached).toBe(claims >= CAP);
      expect(result.stopReason).toBe(claims >= CAP ? 'guard' : 'drained');
    });
  });

  describe('the claim count is asserted directly, because nothing else can see it', () => {
    it('promotes identically whether the tick stops early or late', () => {
      seedOrdersInStatus(harness.connection, CHUNK * 2 + 3, 'pending');

      const result = task.runTick();

      // The promoted count is the same number the old loop produced. If this were
      // the only assertion in the file, the feature would be untestable.
      expect(result.promoted).toBe(CHUNK * 2 + 3);
      expect(pendingCount()).toBe(0);
      // The claim count is the only observable that moved.
      expect(result.iterations).toBe(3);
    });

    it('always performs at least one claim and never more than the cap', () => {
      for (const backlog of [0, 3, CHUNK, CHUNK * CAP * 2]) {
        if (backlog > 0) seedOrdersInStatus(harness.connection, backlog, 'pending');

        const result = task.runTick();

        expect(result.iterations).toBeGreaterThanOrEqual(1);
        expect(result.iterations).toBeLessThanOrEqual(CAP);

        // Drain whatever is left so the next backlog starts clean, since the
        // per-test hook only runs between tests rather than inside one.
        while (task.runTick().promoted > 0) {
          /* keep draining */
        }
      }
    });
  });

  describe('the stop reason is readable from the tick record alone (FR-023)', () => {
    it('records why the tick stopped alongside the existing fields', () => {
      seedOrdersInStatus(harness.connection, 4, 'pending');
      harness.clearLogs();

      task.runTick();

      const [record] = harness.records('order.promotion.tick');

      expect(record).toMatchObject({
        task: 'order-promotion',
        iterations: 1,
        promoted: 4,
        capReached: false,
        stopReason: 'drained',
      });
      expect(typeof record!.durationMs).toBe('number');
    });

    it('distinguishes the guard from a drain in the same record', () => {
      seedOrdersInStatus(harness.connection, CHUNK * CAP * 2, 'pending');
      harness.clearLogs();

      task.runTick();

      const [record] = harness.records('order.promotion.tick');
      expect(record).toMatchObject({ capReached: true, stopReason: 'guard' });
    });
  });
});
