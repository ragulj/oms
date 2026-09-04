import { StructuredLogger } from '../../src/logging/logger';
import { REDACTED } from '../../src/logging/redact';
import { createTestApp } from '../setup/test-app';

// SC-011 and FR-031
describe('structured logging', () => {
  it('emits records that parse without special-case handling', async () => {
    const harness = await createTestApp({ SCHEDULER_INTERVAL_MS: '60', LOG_LEVEL: 'debug' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await harness.close();

    expect(harness.logLines.length).toBeGreaterThan(0);

    for (const line of harness.logLines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(typeof record.timestamp).toBe('string');
      expect(typeof record.level).toBe('string');
      expect(typeof record.message).toBe('string');
    }
  });

  it('redacts secrets rather than printing them', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('info', (line) => lines.push(line));

    logger.emit('info', 'startup', {
      databasePath: './data/oms.db',
      apiKey: 'super-secret-value',
      nested: { password: 'hunter2', port: 3000 },
    });

    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(record.apiKey).toBe(REDACTED);
    expect((record.nested as Record<string, unknown>).password).toBe(REDACTED);
    expect((record.nested as Record<string, unknown>).port).toBe(3000);
    expect(lines[0]).not.toContain('super-secret-value');
    expect(lines[0]).not.toContain('hunter2');
  });

  it('honours the configured verbosity threshold', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('warn', (line) => lines.push(line));

    logger.emit('error', 'kept');
    logger.emit('warn', 'kept');
    logger.emit('info', 'dropped');
    logger.emit('debug', 'dropped');

    expect(lines).toHaveLength(2);
  });
});
