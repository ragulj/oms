import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config/configuration';
import { createConnection } from '../src/database/client';
import { StructuredLogger } from '../src/logging/logger';
import { buildOpenApiDocument } from '../src/docs/openapi.document';

/**
 * FR-064, FR-065, FR-066. Produces the committed `openapi.json` and checks it.
 *
 * The application graph is built but never listened on, and it runs against an
 * in-memory database that is discarded, so obtaining the contract needs neither
 * a port nor a migrated database file. The document is generated from routing
 * metadata and schemas; nothing here reads or writes application data.
 *
 * Writing and checking share one generator on purpose. Two code paths that each
 * decided what the document should be would eventually disagree, and the gate
 * would then be checking one of them against the other rather than against the
 * implementation.
 */

export const EXPORT_PATH = join(__dirname, '..', 'openapi.json');

/** Two spaces and a trailing newline is what Prettier produces for JSON, and `npm run check` formats this file like any other. */
function serialise(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function generateDocumentText(): Promise<string> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'error',
  } as NodeJS.ProcessEnv);

  // Discarded, so generation cannot depend on stored data.
  const logger = new StructuredLogger(config.LOG_LEVEL, () => {});
  const connection = createConnection(':memory:');

  const app = await NestFactory.create(AppModule.register({ config, connection, logger }), {
    logger,
    abortOnError: false,
  });

  // Identical to main.ts. The prefix decides the documented paths, so a document
  // generated without it would describe an API nobody serves.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  try {
    return serialise(buildOpenApiDocument(app));
  } finally {
    await app.close();
    connection.close();
  }
}

async function main(): Promise<void> {
  const checking = process.argv.includes('--check');
  const generated = await generateDocumentText();

  if (!checking) {
    writeFileSync(EXPORT_PATH, generated, 'utf8');
    process.stdout.write(`Wrote ${EXPORT_PATH}\n`);
    return;
  }

  if (!existsSync(EXPORT_PATH)) {
    process.stderr.write(
      `openapi.json is missing. Run "npm run openapi:export" and commit the result.\n`,
    );
    process.exit(1);
  }

  const committed = readFileSync(EXPORT_PATH, 'utf8');
  if (committed === generated) {
    process.stdout.write('openapi.json is up to date.\n');
    return;
  }

  process.stderr.write(
    [
      'openapi.json does not match the implementation.',
      '',
      'The API surface changed and the committed document did not follow, or the document',
      'was edited by hand. Run "npm run openapi:export" and commit the result.',
      '',
      firstDifference(committed, generated),
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/** A diff line is what makes the failure actionable; a boolean is not. */
function firstDifference(committed: string, generated: string): string {
  const committedLines = committed.split('\n');
  const generatedLines = generated.split('\n');
  const limit = Math.max(committedLines.length, generatedLines.length);

  for (let index = 0; index < limit; index += 1) {
    if (committedLines[index] !== generatedLines[index]) {
      return [
        `First difference at line ${index + 1}:`,
        `  committed: ${committedLines[index] ?? '<end of file>'}`,
        `  generated: ${generatedLines[index] ?? '<end of file>'}`,
      ].join('\n');
    }
  }

  return 'The files differ only in trailing content.';
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`openapi export failed: ${String(error)}\n`);
    process.exit(1);
  });
}
