import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/config.schema';
import type { StructuredLogger } from '../logging/logger';
import { CONFIG, LOGGER } from '../tokens';
import { OverlapGuard } from './overlap-guard';

export const HEARTBEAT_INTERVAL_NAME = 'heartbeat';

/**
 * FR-027: a placeholder carrying no business behaviour, existing only to prove
 * recurring work registers and fires. Expected to be replaced, not extended,
 * when real scheduled work arrives.
 */
@Injectable()
export class HeartbeatTask implements OnModuleInit, OnModuleDestroy {
  private ticks = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    private readonly registry: SchedulerRegistry,
    private readonly guard: OverlapGuard,
  ) {}

  get tickCount(): number {
    return this.ticks;
  }

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.tick();
    }, this.config.SCHEDULER_INTERVAL_MS);
    this.registry.addInterval(HEARTBEAT_INTERVAL_NAME, interval);
    this.logger.emit('info', 'scheduler.registered', {
      task: HEARTBEAT_INTERVAL_NAME,
      intervalMs: this.config.SCHEDULER_INTERVAL_MS,
    });
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', HEARTBEAT_INTERVAL_NAME)) {
      this.registry.deleteInterval(HEARTBEAT_INTERVAL_NAME);
    }
  }

  async tick(): Promise<void> {
    const outcome = await this.guard.run(() => {
      this.ticks += 1;
      this.logger.emit('info', 'scheduler.heartbeat', {
        task: HEARTBEAT_INTERVAL_NAME,
        tick: this.ticks,
      });
    });

    if (outcome !== 'ran') {
      this.logger.emit('warn', 'scheduler.heartbeat.skipped', {
        task: HEARTBEAT_INTERVAL_NAME,
        reason: outcome,
      });
    }
  }
}
