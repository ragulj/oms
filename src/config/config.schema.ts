import { z } from 'zod';
import { LOG_LEVELS } from '../logging/logger';

const positiveInt = (label: string) =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .positive(`${label} must be greater than zero`);

/**
 * The complete set of settings the service recognises (data-model.md).
 * Durations reject zero and negative values: a zero drain timeout would make
 * FR-032's drain unobservable, and a zero interval would spin the scheduler.
 */
export const configSchema = z.object({
  DATABASE_PATH: z
    .string({ message: 'DATABASE_PATH is required' })
    .min(1, 'DATABASE_PATH must not be empty'),
  PORT: positiveInt('PORT').max(65535, 'PORT must be at most 65535').default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SCHEDULER_INTERVAL_MS: positiveInt('SCHEDULER_INTERVAL_MS').default(300_000),
  SHUTDOWN_DRAIN_TIMEOUT_MS: positiveInt('SHUTDOWN_DRAIN_TIMEOUT_MS').default(10_000),

  // Their product, 1000 orders per tick, is the blocking-time budget Constitution
  // Principle III is about, not a throughput target.
  ORDER_PROMOTION_CHUNK_SIZE: positiveInt('ORDER_PROMOTION_CHUNK_SIZE').default(100),
  ORDER_PROMOTION_MAX_ITERATIONS: positiveInt('ORDER_PROMOTION_MAX_ITERATIONS').default(10),

  // Spec 004 FR-057. `stringbool`, not `coerce.boolean`: the latter applies
  // JavaScript truthiness, so DOCS_ENABLED=false would parse as true and serve
  // documentation with nothing in the logs to explain it (research R13).
  DOCS_ENABLED: z.stringbool().default(true),
});

export type AppConfig = z.infer<typeof configSchema>;

export const CONFIG_TOKEN = Symbol('APP_CONFIG');
