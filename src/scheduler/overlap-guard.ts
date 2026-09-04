import { Injectable } from '@nestjs/common';

export type RunOutcome = 'ran' | 'skipped-overlap' | 'skipped-shutdown';

/**
 * FR-028 and FR-034. @nestjs/schedule does not prevent overlapping executions
 * on its own: a tick that outruns its interval is started again concurrently.
 * This guard is application state, not a configuration flag.
 */
@Injectable()
export class OverlapGuard {
  private running = false;
  private shuttingDown = false;

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async run(task: () => Promise<void> | void): Promise<RunOutcome> {
    if (this.shuttingDown) {
      return 'skipped-shutdown';
    }
    if (this.running) {
      return 'skipped-overlap';
    }
    this.running = true;
    try {
      await task();
      return 'ran';
    } finally {
      this.running = false;
    }
  }
}
