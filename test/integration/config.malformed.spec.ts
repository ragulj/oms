import { loadConfig } from '../../src/config/configuration';

// User Story 4, scenario 2 and FR-007
describe('configuration with a malformed setting', () => {
  const base = { DATABASE_PATH: './data/oms.db' };

  it('names the setting and what was expected for a non-numeric port', () => {
    try {
      loadConfig({ ...base, PORT: 'not-a-number' } as NodeJS.ProcessEnv);
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toMatch(/number/i);
    }
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'chatty' } as NodeJS.ProcessEnv)).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('rejects a zero scheduler interval, which would spin the scheduler', () => {
    expect(() => loadConfig({ ...base, SCHEDULER_INTERVAL_MS: '0' } as NodeJS.ProcessEnv)).toThrow(
      /SCHEDULER_INTERVAL_MS/,
    );
  });

  it('rejects a negative drain timeout, which would make the drain unobservable', () => {
    expect(() =>
      loadConfig({ ...base, SHUTDOWN_DRAIN_TIMEOUT_MS: '-1' } as NodeJS.ProcessEnv),
    ).toThrow(/SHUTDOWN_DRAIN_TIMEOUT_MS/);
  });
});
