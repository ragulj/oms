import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
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
  // Ensure the directory holding the database file exists before opening it. A
  // fresh checkout has no such directory (it is gitignored), so creating it here
  // rather than rejecting a missing one is what lets the service start on a
  // clean checkout without a manual mkdir. Recursive create is idempotent; a
  // genuine failure (permission denial, or a file where the directory must be)
  // surfaces as the same DatabaseUnavailableError a bad path already produces.
  if (databasePath !== ':memory:') {
    try {
      mkdirSync(dirname(databasePath), { recursive: true });
    } catch (cause) {
      throw new DatabaseUnavailableError(databasePath, cause);
    }
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
