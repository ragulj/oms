import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/config/configuration';
import { createConnection, type Connection } from '../../src/database/client';
import { StructuredLogger } from '../../src/logging/logger';
import { TEST_DB_PATH } from './database';

export interface TestHarness {
  app: INestApplication;
  connection: Connection;
  logLines: string[];
  close(): Promise<void>;
}

/**
 * Builds the real application graph against the throwaway database. Log output
 * is captured rather than written to stdout so tests can assert on structured
 * records (SC-011).
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestHarness> {
  const config = loadConfig({
    DATABASE_PATH: TEST_DB_PATH,
    // Long enough that no heartbeat fires unless a test asks for one.
    SCHEDULER_INTERVAL_MS: '3600000',
    ...env,
  } as NodeJS.ProcessEnv);

  const logLines: string[] = [];
  const logger = new StructuredLogger(config.LOG_LEVEL, (line) => logLines.push(line));
  const connection = createConnection(config.DATABASE_PATH);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ config, connection, logger })],
  }).compile();

  const app = moduleRef.createNestApplication({ logger });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  await app.init();

  return {
    app,
    connection,
    logLines,
    close: async () => {
      await app.close();
      connection.close();
    },
  };
}
