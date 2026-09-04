import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export const MIGRATIONS_FOLDER = 'drizzle';
const LEDGER_TABLE = '__drizzle_migrations';

interface Journal {
  entries?: { tag: string }[];
}

export class PendingMigrationsError extends Error {
  constructor(readonly pending: string[]) {
    super(
      `Refusing to start: ${pending.length} migration(s) pending:\n  - ${pending.join('\n  - ')}\n` +
        'Apply them with the documented migration command. The service never applies them itself.',
    );
    this.name = 'PendingMigrationsError';
  }
}

function appliedCount(sqlite: Database.Database): number {
  const table = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(LEDGER_TABLE);
  if (!table) {
    return 0;
  }
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${LEDGER_TABLE}`).get() as {
    count: number;
  };
  return row.count;
}

export function pendingMigrations(
  sqlite: Database.Database,
  migrationsFolder = MIGRATIONS_FOLDER,
): string[] {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return [];
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const entries = journal.entries ?? [];
  return entries.slice(appliedCount(sqlite)).map((entry) => entry.tag);
}

/**
 * FR-015: the service refuses to boot while any migration is pending, naming
 * them. Migrations are applied only by the documented command, never during
 * startup: on a single-writer engine two processes racing to migrate is a real
 * hazard, not a theoretical one.
 */
export function assertMigrationsCurrent(
  sqlite: Database.Database,
  migrationsFolder = MIGRATIONS_FOLDER,
): void {
  const pending = pendingMigrations(sqlite, migrationsFolder);
  if (pending.length > 0) {
    throw new PendingMigrationsError(pending);
  }
}
