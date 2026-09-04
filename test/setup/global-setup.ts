import { runMigrations } from '../../src/database/migrate';
import { ensureTestDbDir, removeTestDatabase, TEST_DB_PATH } from './database';

/**
 * Removing first handles the edge case of an interrupted earlier run leaving its
 * throwaway database behind. Migrations are applied explicitly here rather than
 * by a boot-time side effect, which FR-015 forbids.
 */
export default function globalSetup(): void {
  ensureTestDbDir();
  removeTestDatabase();
  runMigrations(TEST_DB_PATH);
}
