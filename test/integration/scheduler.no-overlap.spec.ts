import { OverlapGuard } from '../../src/scheduler/overlap-guard';

/**
 * User Story 6, scenario 2, FR-028, FR-034 and SC-008. @nestjs/schedule does not
 * prevent overlap on its own, so this guard is the requirement.
 */
describe('overlap prevention', () => {
  it('skips an execution while the previous one is still running', async () => {
    const guard = new OverlapGuard();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = guard.run(() => blocked);
    await Promise.resolve();

    expect(guard.isRunning).toBe(true);
    await expect(guard.run(() => undefined)).resolves.toBe('skipped-overlap');

    release();
    await expect(first).resolves.toBe('ran');
    expect(guard.isRunning).toBe(false);
  });

  it('runs again once the previous execution has finished', async () => {
    const guard = new OverlapGuard();

    await expect(guard.run(() => undefined)).resolves.toBe('ran');
    await expect(guard.run(() => undefined)).resolves.toBe('ran');
  });

  it('starts no new execution once shutdown has begun', async () => {
    const guard = new OverlapGuard();
    guard.beginShutdown();

    await expect(guard.run(() => undefined)).resolves.toBe('skipped-shutdown');
  });

  it('releases the in-flight flag even when the task throws', async () => {
    const guard = new OverlapGuard();

    await expect(
      guard.run(() => {
        throw new Error('task failed');
      }),
    ).rejects.toThrow('task failed');

    expect(guard.isRunning).toBe(false);
  });
});
