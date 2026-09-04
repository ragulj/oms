import { configSchema } from '../../src/config/config.schema';
import { createTestApp } from '../setup/test-app';

// User Story 6, scenario 3 and FR-029
describe('the scheduled task interval', () => {
  const registeredInterval = (lines: string[]): number | undefined =>
    lines
      .map((line) => JSON.parse(line) as { message: string; intervalMs?: number })
      .find((record) => record.message === 'scheduler.registered')?.intervalMs;

  it('defaults to five minutes, matching the constitution cadence', () => {
    const config = configSchema.parse({ DATABASE_PATH: './data/oms.db' });
    expect(config.SCHEDULER_INTERVAL_MS).toBe(300_000);
  });

  it('takes effect from configuration without a code change', async () => {
    const fast = await createTestApp({ SCHEDULER_INTERVAL_MS: '250' });
    const slow = await createTestApp({ SCHEDULER_INTERVAL_MS: '900' });

    try {
      expect(registeredInterval(fast.logLines)).toBe(250);
      expect(registeredInterval(slow.logLines)).toBe(900);
    } finally {
      await fast.close();
      await slow.close();
    }
  });
});
