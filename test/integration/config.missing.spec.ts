import { ConfigValidationError, loadConfig } from '../../src/config/configuration';

// User Story 4, scenario 1 and FR-007
describe('configuration with a required setting absent', () => {
  it('throws and names the missing setting', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);

    try {
      loadConfig({} as NodeJS.ProcessEnv);
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_PATH');
    }
  });

  it('rejects an empty value rather than treating it as present', () => {
    expect(() => loadConfig({ DATABASE_PATH: '' } as NodeJS.ProcessEnv)).toThrow(/DATABASE_PATH/);
  });

  it('applies documented defaults when optional settings are omitted', () => {
    const config = loadConfig({ DATABASE_PATH: './data/oms.db' } as NodeJS.ProcessEnv);

    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SCHEDULER_INTERVAL_MS).toBe(300_000);
    expect(config.SHUTDOWN_DRAIN_TIMEOUT_MS).toBe(10_000);
  });
});
