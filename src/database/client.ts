import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Connection {
  sqlite: Database.Database;
  db: Db;
  close(): void;
}

export class DatabaseUnavailableError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Database at ${path} is unreachable or not writable: ${String(cause)}`);
    this.name = 'DatabaseUnavailableError';
  }
}

/**
 * FR-013: the durability, referential integrity, and write-contention settings
 * the constitution requires, applied to every connection the system opens,
 * including those opened by tests.
 */
export function applyPragmas(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
}

export function createConnection(databasePath: string): Connection {
  const directory = dirname(databasePath);
  if (databasePath !== ':memory:' && !existsSync(directory)) {
    throw new DatabaseUnavailableError(databasePath, `directory ${directory} does not exist`);
  }

  let sqlite: Database.Database;
  try {
    sqlite = new Database(databasePath);
    applyPragmas(sqlite);
  } catch (cause) {
    throw new DatabaseUnavailableError(databasePath, cause);
  }

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    // Idempotent: the health-degradation test closes the database on purpose,
    // and teardown must not then fail on a second close.
    close: () => {
      if (sqlite.open) {
        sqlite.close();
      }
    },
  };
}
