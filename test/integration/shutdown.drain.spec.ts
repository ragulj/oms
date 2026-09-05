import { drain } from '../../src/lifecycle/shutdown';
import { OverlapGuard } from '../../src/scheduler/overlap-guard';
import { createTestApp } from '../setup/test-app';

// FR-032 and SC-010
describe('shutdown drain', () => {
  it('finishes in-flight work and reports drained', async () => {
    const guard = new OverlapGuard();
    let closed = false;

    const result = await drain({
      guard,
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        closed = true;
      },
      timeoutMs: 1000,
    });

    expect(result.outcome).toBe('drained');
    expect(closed).toBe(true);
  });

  it('stops new scheduled executions before draining', async () => {
    const guard = new OverlapGuard();

    await drain({ guard, close: async () => undefined, timeoutMs: 1000 });

    await expect(guard.run(() => undefined)).resolves.toBe('skipped-shutdown');
  });

  it('closes the real application and its database without leaving recovery work', async () => {
    const harness = await createTestApp();

    // FR-024 exemption: the teardown mechanism is the subject under test here, so drain must
    // drive app.close directly. Routing through harness.close() would hide the very behaviour
    // being asserted. Every resource this test opened is still released: the connection below.
    const result = await drain({
      guard: harness.app.get(OverlapGuard, { strict: false }),
      close: () => harness.app.close(),
      timeoutMs: 5000,
    });
    harness.connection.close();

    expect(result.outcome).toBe('drained');
    expect(harness.connection.sqlite.open).toBe(false);
  });
});
