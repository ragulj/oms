import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from '../../src/database/client';
import { runMigrations } from '../../src/database/migrate';
import {
  assertMigrationsCurrent,
  PendingMigrationsError,
  pendingMigrations,
} from '../../src/database/migration-state';

/**
 * User Story 2, scenario 5 and FR-015. The startup check refuses to boot while
 * anything is pending and names it. Migrations are never applied during startup.
 */
describe('startup against a database with pending migrations', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oms-migrate-pending-'));
    dbPath = join(dir, 'pending.db');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to start and names the pending migration', () => {
    const connection = createConnection(dbPath);
    try {
      const pending = pendingMigrations(connection.sqlite);
      expect(pending.length).toBeGreaterThan(0);

      expect(() => assertMigrationsCurrent(connection.sqlite)).toThrow(PendingMigrationsError);

      try {
        assertMigrationsCurrent(connection.sqlite);
      } catch (error) {
        expect((error as Error).message).toContain(pending[0] as string);
      }
    } finally {
      connection.close();
    }
  });

  it('does not apply the migration as a side effect of the check', () => {
    const connection = createConnection(dbPath);
    try {
      expect(pendingMigrations(connection.sqlite).length).toBeGreaterThan(0);
    } finally {
      connection.close();
    }
  });

  it('starts cleanly once the documented command has been run', () => {
    runMigrations(dbPath);

    const connection = createConnection(dbPath);
    try {
      expect(() => assertMigrationsCurrent(connection.sqlite)).not.toThrow();
    } finally {
      connection.close();
    }
  });
});
