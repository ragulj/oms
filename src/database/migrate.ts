import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createConnection } from './client';
import { MIGRATIONS_FOLDER } from './migration-state';
import { loadConfig, loadEnvFile } from '../config/configuration';

/**
 * FR-011: safe to run repeatedly. Drizzle's migrator consults the ledger and
 * applies only what is pending, so a second run against a current database
 * makes no changes.
 */
export function runMigrations(databasePath: string, migrationsFolder = MIGRATIONS_FOLDER): void {
  const connection = createConnection(databasePath);
  try {
    migrate(connection.db, { migrationsFolder });
  } finally {
    connection.close();
  }
}

if (require.main === module) {
  loadEnvFile();
  const config = loadConfig();
  runMigrations(config.DATABASE_PATH);
  process.stdout.write(`Migrations applied to ${config.DATABASE_PATH}\n`);
}
