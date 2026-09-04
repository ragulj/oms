import { drain } from '../../src/lifecycle/shutdown';
import { OverlapGuard } from '../../src/scheduler/overlap-guard';

// FR-033
describe('shutdown drain timeout', () => {
  it('reports a timeout instead of hanging when work never finishes', async () => {
    const guard = new OverlapGuard();

    const result = await drain({
      guard,
      close: () => new Promise<void>(() => {}),
      timeoutMs: 50,
    });

    expect(result.outcome).toBe('timeout');
  });

  it('records that a scheduled task was what got abandoned', async () => {
    const guard = new OverlapGuard();
    const running = guard.run(() => new Promise<void>(() => {}));
    void running;
    await Promise.resolve();

    const result = await drain({
      guard,
      close: () => new Promise<void>(() => {}),
      timeoutMs: 50,
    });

    expect(result).toEqual({ outcome: 'timeout', abandoned: 'scheduled task still running' });
  });

  it('records in-flight requests when no scheduled task is running', async () => {
    const result = await drain({
      guard: new OverlapGuard(),
      close: () => new Promise<void>(() => {}),
      timeoutMs: 50,
    });

    expect(result).toEqual({ outcome: 'timeout', abandoned: 'in-flight requests' });
  });
});
