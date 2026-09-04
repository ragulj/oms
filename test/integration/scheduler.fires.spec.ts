import { HeartbeatTask } from '../../src/scheduler/heartbeat.task';
import { createTestApp, type TestHarness } from '../setup/test-app';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * User Story 6, scenario 1. The five-minute default exceeds the whole
 * verification budget, so FR-029 requires tests to override the interval through
 * configuration rather than waiting on it.
 */
describe('the placeholder recurring task', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp({ SCHEDULER_INTERVAL_MS: '60' });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('executes on each elapsed interval and leaves observable evidence', async () => {
    const task = harness.app.get(HeartbeatTask, { strict: false });

    await wait(400);

    expect(task.tickCount).toBeGreaterThanOrEqual(3);

    const heartbeats = harness.logLines
      .map((line) => JSON.parse(line) as { message: string; tick?: number })
      .filter((record) => record.message === 'scheduler.heartbeat');

    expect(heartbeats.length).toBeGreaterThanOrEqual(3);
    expect(heartbeats[0]?.tick).toBe(1);
  });
});
