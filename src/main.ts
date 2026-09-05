import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig, loadEnvFile } from './config/configuration';
import { createConnection, type Connection } from './database/client';
import { assertMigrationsCurrent } from './database/migration-state';
import { StructuredLogger } from './logging/logger';
import { correlationMiddleware } from './http/correlation';
import { drain } from './lifecycle/shutdown';
import { OverlapGuard } from './scheduler/overlap-guard';

export const MINIMUM_NODE_MAJOR = 22;

/**
 * FR-003. The floor is derived, not pinned: better-sqlite3 requires >=22, above
 * the framework's >=20, so 22 is the highest floor among direct dependencies.
 * Recompute this whenever dependencies change.
 */
export function assertSupportedRuntime(version = process.versions.node): void {
  const major = Number(version.split('.')[0]);
  if (Number.isNaN(major) || major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Node ${MINIMUM_NODE_MAJOR} or newer is required; this process is running ${version}.`,
    );
  }
}

function fail(message: string, detail: unknown): never {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      detail: detail instanceof Error ? detail.message : String(detail),
    })}\n`,
  );
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  try {
    assertSupportedRuntime();
  } catch (error) {
    fail('startup.unsupported_runtime', error);
  }

  loadEnvFile();

  const config = (() => {
    try {
      return loadConfig();
    } catch (error) {
      return fail('startup.invalid_configuration', error);
    }
  })();

  const logger = new StructuredLogger(config.LOG_LEVEL);

  const connection: Connection = (() => {
    try {
      return createConnection(config.DATABASE_PATH);
    } catch (error) {
      return fail('startup.database_unavailable', error);
    }
  })();

  try {
    assertMigrationsCurrent(connection.sqlite);
  } catch (error) {
    connection.close();
    fail('startup.migrations_pending', error);
  }

  const app = await NestFactory.create(AppModule.register({ config, connection, logger }), {
    logger,
  });

  // Spec 003 FR-007. Applied ahead of routing so a request that matches no
  // controller still carries a correlation identifier into the error response.
  app.use(correlationMiddleware);

  // FR-035: domain routes live under a versioned prefix; health stays outside it
  // so supervisors and probes never track the API version.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.emit('info', 'shutdown.started', {
      signal,
      timeoutMs: config.SHUTDOWN_DRAIN_TIMEOUT_MS,
    });

    // FR-034 (no new scheduled execution) and FR-033 (bounded drain, non-zero
    // exit recording what was abandoned) both live in drain().
    const result = await drain({
      guard: app.get(OverlapGuard, { strict: false }),
      close: () => app.close(),
      timeoutMs: config.SHUTDOWN_DRAIN_TIMEOUT_MS,
    });

    connection.close();

    if (result.outcome === 'timeout') {
      logger.emit('error', 'shutdown.timeout', {
        signal,
        timeoutMs: config.SHUTDOWN_DRAIN_TIMEOUT_MS,
        abandoned: result.abandoned,
      });
      process.exit(1);
    }

    logger.emit('info', 'shutdown.complete', { signal });
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  await app.listen(config.PORT);

  // FR-031: startup record. Secrets are redacted by the logger.
  logger.emit('info', 'service.started', {
    port: config.PORT,
    databasePath: config.DATABASE_PATH,
    connectionSettings: { journal_mode: 'WAL', foreign_keys: 'ON', busy_timeout: 5000 },
    schedulerIntervalMs: config.SCHEDULER_INTERVAL_MS,
    shutdownDrainTimeoutMs: config.SHUTDOWN_DRAIN_TIMEOUT_MS,
    logLevel: config.LOG_LEVEL,
    nodeVersion: process.versions.node,
  });
}

if (require.main === module) {
  void bootstrap();
}
