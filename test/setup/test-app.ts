import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { mountApiDocumentation } from '../../src/docs/openapi.document';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/config/configuration';
import { createConnection, type Connection } from '../../src/database/client';
import { correlationMiddleware } from '../../src/http/correlation';
import { StructuredLogger } from '../../src/logging/logger';
import { TEST_DB_PATH } from './database';

export interface TestHarness {
  app: INestApplication;
  connection: Connection;
  logLines: string[];
  /** The served document, present only when documentation was mounted. */
  document?: OpenAPIObject;
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
    // Long enough that no promotion tick fires unless a test asks for one.
    SCHEDULER_INTERVAL_MS: '3600000',
    // Off by default, unlike the service, so the ~250 tests that predate Spec 004
    // do not each pay to build a document they never read. The documentation
    // suites opt in with DOCS_ENABLED: 'true', and non-interference.spec.ts
    // builds one application each way to prove the two agree.
    DOCS_ENABLED: 'false',
    ...env,
  } as NodeJS.ProcessEnv);

  const logLines: string[] = [];
  const logger = new StructuredLogger(config.LOG_LEVEL, (line) => logLines.push(line));
  const connection = createConnection(config.DATABASE_PATH);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ config, connection, logger })],
  }).compile();

  const app = moduleRef.createNestApplication({ logger });
  // Identical to main.ts, so the graph a test drives is the graph that ships.
  app.use(correlationMiddleware);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Spec 004 FR-084. Mounted through the same function main.ts calls, under the
  // same condition, so a documentation test exercises the shipped arrangement
  // rather than a parallel one assembled for the test.
  const document = config.DOCS_ENABLED ? mountApiDocumentation(app) : undefined;

  await app.init();

  return {
    app,
    connection,
    logLines,
    ...(document === undefined ? {} : { document }),
    close: async () => {
      await app.close();
      connection.close();
    },
  };
}
