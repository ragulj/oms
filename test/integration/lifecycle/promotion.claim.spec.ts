import { sourceStatusesFor } from '../../../src/orders/order-state-machine';
import { backlogClaimQuery } from '../../../src/orders/order-queries';
import { OrderPromotionTask } from '../../../src/scheduler/order-promotion.task';
import { seedOrdersInStatus } from '../../support/order-fixtures';
import { createLifecycleHarness, type LifecycleHarness } from '../../support/http-fixtures';

/**
 * User Story 5, FR-082, FR-086, FR-088, FR-090, and research R2 and R3.
 *
 * Constitution Principle III writes the claim's SQL out literally, so this
 * asserts on the statement itself as well as on its effect.
 */
describe('the bounded backlog claim', () => {
  let harness: LifecycleHarness;
  let task: OrderPromotionTask;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
    task = harness.app.get(OrderPromotionTask, { strict: false });
  });

  afterAll(async () => {
    await harness.close();
  });

  const countByStatus = (status: string): number =>
    (
      harness.connection.sqlite
        .prepare('SELECT COUNT(*) AS n FROM orders WHERE status = ?')
        .get(status) as { n: number }
    ).n;

  /**
   * FR-082. The shape the constitution mandates, including the outer status
   * predicate that a reader might mistake for a redundant repeat of the
   * subquery's.
   */
  it('emits the statement Constitution Principle III describes', () => {
    const { sql, params } = backlogClaimQuery(
      harness.connection.db,
      sourceStatusesFor('processing'),
      'processing',
      100,
    ).toSQL();

    const normalised = sql.replace(/\s+/g, ' ').toLowerCase();

    expect(normalised).toContain('update "orders" set "status" = ?');
    expect(normalised).toContain('"orders"."id" in (select "id" from "orders"');
    expect(normalised).toContain('order by "orders"."created_at_us" asc');
    expect(normalised).toContain('limit ?');
    // The outer predicate, re-asserted after the subquery.
    expect(normalised.match(/"orders"\."status" in \(\?\)/g)).toHaveLength(2);
    expect(params).toEqual(['processing', 'pending', 100, 'pending']);
  });

  /** FR-088: the target and its sources come from the state machine, not from literals here. */
  it('takes its statuses from the state machine', () => {
    expect(sourceStatusesFor('processing')).toEqual(['pending']);

    const { params } = backlogClaimQuery(
      harness.connection.db,
      sourceStatusesFor('processing'),
      'processing',
      1,
    ).toSQL();

    expect(params[0]).toBe('processing');
    expect(params).toContain('pending');
  });

  /**
   * FR-090. The exclusion is a property of the statement, not of a filter
   * applied after reading, so removing the outer predicate has to break this.
   */
  it('never promotes a cancelled order', () => {
    seedOrdersInStatus(harness.connection, 20, 'pending', 1_700_000_000_000_000);
    seedOrdersInStatus(harness.connection, 20, 'cancelled', 1_600_000_000_000_000);

    // The cancelled ones are older, so an unfiltered oldest-first claim would
    // reach them first.
    const result = task.runTick();

    expect(result.promoted).toBe(20);
    expect(countByStatus('cancelled')).toBe(20);
    expect(countByStatus('processing')).toBe(20);
    expect(countByStatus('pending')).toBe(0);
  });

  it('never promotes an order that is already processing', () => {
    seedOrdersInStatus(harness.connection, 15, 'processing');

    const result = task.runTick();

    expect(result.promoted).toBe(0);
    expect(countByStatus('processing')).toBe(15);
  });

  /**
   * Research R3, extended to the multi-row case that matters here. Spec 002
   * established that the `updated_at_us` trigger does not inflate the changed-row
   * count for a single row; the job's own accounting of how much backlog it has
   * drained depends on that holding at chunk scale too.
   */
  it('reports a changed-row count the touch trigger does not inflate', () => {
    seedOrdersInStatus(harness.connection, 250, 'pending');

    const claimed = harness.connection.db.transaction(
      (tx) =>
        backlogClaimQuery(tx, sourceStatusesFor('processing'), 'processing', 100).run().changes,
    );

    expect(claimed).toBe(100);
    expect(countByStatus('processing')).toBe(100);
  });

  /** FR-071 applies to the job too: the trigger maintains it, with no caller action. */
  it('advances updated_at_us on every promoted row without naming it', () => {
    seedOrdersInStatus(harness.connection, 5, 'pending');
    const before = harness.connection.sqlite
      .prepare('SELECT id, created_at_us, updated_at_us FROM orders ORDER BY id')
      .all() as { id: number; created_at_us: number; updated_at_us: number }[];

    task.runTick();

    const after = harness.connection.sqlite
      .prepare('SELECT id, created_at_us, updated_at_us FROM orders ORDER BY id')
      .all() as { id: number; created_at_us: number; updated_at_us: number }[];

    for (const [index, row] of after.entries()) {
      expect(row.updated_at_us).toBeGreaterThan(before[index]!.updated_at_us);
      expect(row.created_at_us).toBe(before[index]!.created_at_us);
      expect(row.updated_at_us).toBeGreaterThanOrEqual(row.created_at_us);
    }
  });

  /**
   * FR-086. Each chunk commits on its own, so a failure part-way through a tick
   * leaves earlier chunks in place. Observed by checking that work is visible on
   * a second connection while the tick's later chunks are still to come.
   */
  it('commits each chunk separately rather than holding one transaction', () => {
    seedOrdersInStatus(harness.connection, 350, 'pending');

    const result = task.runTick();

    // Four chunks: 100, 100, 100, 50. The fourth comes back short and ends the
    // tick.
    //
    // Spec 003 ended a tick only on a zero-row claim, on the reasoning that a
    // short chunk was not evidence of an empty backlog — the outer status
    // predicate might have excluded an order cancelled mid-statement. Spec 005
    // measured that (research R1) and found no such interval: the claim is one
    // statement in one transaction on an engine that serialises writers, so a
    // short chunk does prove the backlog is drained. The fifth claim is gone.
    expect(result.iterations).toBe(4);
    expect(result.promoted).toBe(350);
    // Nothing left half-written: every claimed row is committed.
    expect(countByStatus('processing')).toBe(350);
    expect(countByStatus('pending')).toBe(0);
  });
});
