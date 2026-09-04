import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from '../../src/database/client';
import { runMigrations } from '../../src/database/migrate';
import { pendingMigrations } from '../../src/database/migration-state';

// User Story 2, scenario 1
describe('applying migrations to an empty database', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oms-migrate-fresh-'));
    dbPath = join(dir, 'fresh.db');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the schema and leaves nothing pending', () => {
    runMigrations(dbPath);

    const connection = createConnection(dbPath);
    try {
      const tables = connection.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[];

      expect(tables.map((t) => t.name)).toContain('harness_probe');
      expect(pendingMigrations(connection.sqlite)).toHaveLength(0);
    } finally {
      connection.close();
    }
  });
});
