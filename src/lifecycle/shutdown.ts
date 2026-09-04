export interface Drainable {
  beginShutdown(): void;
  readonly isRunning: boolean;
}

export interface DrainOptions {
  guard: Drainable;
  close: () => Promise<void>;
  timeoutMs: number;
}

export type DrainResult = { outcome: 'drained' } | { outcome: 'timeout'; abandoned: string };

/**
 * FR-032 and FR-033. Extracted from the signal handler so the timeout branch is
 * reachable by a test rather than only by killing a real process, which on
 * Windows would be a flaky thing to assert on.
 */
export async function drain({ guard, close, timeoutMs }: DrainOptions): Promise<DrainResult> {
  guard.beginShutdown();

  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<DrainResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          outcome: 'timeout',
          abandoned: guard.isRunning ? 'scheduled task still running' : 'in-flight requests',
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([close().then((): DrainResult => ({ outcome: 'drained' })), expiry]);
  } finally {
    clearTimeout(timer);
  }
}
