import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/config.schema';
import type { Connection } from '../database/client';
import { type OrderStatus } from '../database/schema';
import { backlogClaimQuery } from '../orders/order-queries';
import type { StructuredLogger } from '../logging/logger';
import { sourceStatusesFor } from '../orders/order-state-machine';
import { CONFIG, CONNECTION, LOGGER } from '../tokens';
import { OverlapGuard } from './overlap-guard';

export const PROMOTION_INTERVAL_NAME = 'order-promotion';

/** FR-088: taken from the state machine, never written as a literal here. */
const TARGET_STATUS: OrderStatus = 'processing';

export interface TickResult {
  iterations: number;
  promoted: number;
  capReached: boolean;
  durationMs: number;
}

/**
 * Constitution Principle III, and FR-080 to FR-094.
 *
 * The requirement here is the opposite of every other one in this system: this
 * job is correct *because* it stops early. An unbounded UPDATE would hold the
 * single write lock for the length of the whole backlog, and the driver is
 * synchronous, so every chunk blocks the event loop for as long as it runs.
 * Chunk size and iteration cap are not tuning knobs, they are the safety
 * property that keeps the process responsive.
 *
 * Replaces Spec 001's heartbeat placeholder, whose own comment anticipated being
 * replaced rather than extended once real scheduled work arrived.
 */
@Injectable()
export class OrderPromotionTask implements OnModuleInit, OnModuleDestroy {
  private ticks = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CONNECTION) private readonly connection: Connection,
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
    this.registry.addInterval(PROMOTION_INTERVAL_NAME, interval);

    // Spec 001's configurable-interval test reads this record and its
    // intervalMs, so the shape is preserved across the replacement.
    this.logger.emit('info', 'scheduler.registered', {
      task: PROMOTION_INTERVAL_NAME,
      intervalMs: this.config.SCHEDULER_INTERVAL_MS,
      chunkSize: this.config.ORDER_PROMOTION_CHUNK_SIZE,
      maxIterations: this.config.ORDER_PROMOTION_MAX_ITERATIONS,
    });
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('interval', PROMOTION_INTERVAL_NAME)) {
      this.registry.deleteInterval(PROMOTION_INTERVAL_NAME);
    }
  }

  /** FR-091, FR-092: overlap and shutdown are the guard's job, unchanged from Spec 001. */
  async tick(): Promise<void> {
    const outcome = await this.guard.run(() => {
      this.ticks += 1;
      this.runTick();
    });

    if (outcome !== 'ran') {
      this.logger.emit('warn', 'order.promotion.skipped', {
        task: PROMOTION_INTERVAL_NAME,
        reason: outcome,
      });
    }
  }

  /**
   * FR-093. Directly invocable, so the behaviour is exercised without waiting on
   * a five-minute schedule, and without a test depending on elapsed wall-clock
   * time (FR-104).
   */
  runTick(): TickResult {
    const startedAt = Date.now();
    const chunkSize = this.config.ORDER_PROMOTION_CHUNK_SIZE;
    const maxIterations = this.config.ORDER_PROMOTION_MAX_ITERATIONS;

    let iterations = 0;
    let promoted = 0;

    try {
      while (iterations < maxIterations) {
        const claimed = this.claimChunk(chunkSize);
        iterations += 1;
        promoted += claimed;

        // FR-085: nothing left to claim, so the tick ends rather than spending
        // its remaining iterations on empty statements.
        if (claimed === 0) {
          break;
        }
      }
    } catch (error) {
      // FR-094: chunks already committed stay committed. The tick ends and the
      // failure is recorded; the next tick resumes from what remains.
      this.logger.emit('error', 'order.promotion.failed', {
        task: PROMOTION_INTERVAL_NAME,
        iterations,
        promoted,
        detail: error instanceof Error ? error.message : String(error),
      });
      return { iterations, promoted, capReached: false, durationMs: Date.now() - startedAt };
    }

    const result: TickResult = {
      iterations,
      promoted,
      capReached: iterations >= maxIterations,
      durationMs: Date.now() - startedAt,
    };

    // FR-097
    this.logger.emit('info', 'order.promotion.tick', { task: PROMOTION_INTERVAL_NAME, ...result });

    return result;
  }

  /**
   * FR-082, FR-086, FR-089, FR-090. The shape Constitution Principle III writes
   * out literally, expressed through Drizzle rather than raw SQL:
   *
   *   UPDATE orders SET status = 'processing'
   *   WHERE id IN (SELECT id FROM orders WHERE status = 'pending'
   *                ORDER BY created_at_us LIMIT :chunk)
   *     AND status = 'pending';
   *
   * The outer status predicate is not redundant with the subquery's. It is what
   * excludes an order cancelled in the interval between the subquery choosing it
   * and the update reaching it, which makes the exclusion a property of the
   * statement rather than of a filter written in application code.
   *
   * Its own transaction, so no write transaction spans two chunks or a tick.
   */
  private claimChunk(chunkSize: number): number {
    const sources = [...sourceStatusesFor(TARGET_STATUS)];

    return this.connection.db.transaction(
      (tx) => backlogClaimQuery(tx, sources, TARGET_STATUS, chunkSize).run().changes,
    );
  }
}

export { TARGET_STATUS as PROMOTION_TARGET_STATUS };
