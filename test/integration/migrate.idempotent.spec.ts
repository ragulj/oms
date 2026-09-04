import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from '../../src/database/client';
import { runMigrations } from '../../src/database/migrate';

// User Story 2, scenario 2 and FR-011
describe('re-applying migrations to a current database', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oms-migrate-idem-'));
    dbPath = join(dir, 'idempotent.db');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ledgerCount = (): number => {
    const connection = createConnection(dbPath);
    try {
      const row = connection.sqlite
        .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
        .get() as { count: number };
      return row.count;
    } finally {
      connection.close();
    }
  };

  it('makes no changes and does not throw', () => {
    runMigrations(dbPath);
    const afterFirst = ledgerCount();

    expect(() => runMigrations(dbPath)).not.toThrow();

    expect(ledgerCount()).toBe(afterFirst);
  });
});
