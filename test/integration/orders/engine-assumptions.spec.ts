import { createConnection, type Connection } from '../../../src/database/client';
import { TEST_DB_PATH } from '../../setup/database';

/**
 * The data model depends on two engine defaults. Neither is set by this project,
 * so both are asserted rather than assumed: if a future SQLite release or a
 * driver change moves either, the guarantees built on top of them fail silently
 * rather than loudly.
 */
describe('engine assumptions the order model depends on', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  /**
   * research.md R6. The touch trigger on orders updates the same table it fires
   * on. With recursive triggers enabled that would re-enter itself.
   */
  it('leaves recursive triggers off', () => {
    expect(connection.sqlite.pragma('recursive_triggers', { simple: true })).toBe(0);
  });

  /**
   * research.md R4. Stored generated columns, which line_total_minor relies on,
   * arrived in SQLite 3.31.
   */
  it('runs a SQLite new enough for stored generated columns', () => {
    const { v } = connection.sqlite.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    const [major = 0, minor = 0] = v.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(3);
    expect(major > 3 || minor >= 31).toBe(true);
  });

  /**
   * FR-034b. Constitution Principle II decides the 409 response from the driver's
   * changed-row count, so a trigger that contributed to that count would turn a
   * lost race into a reported success. SQLite excludes trigger-modified rows;
   * this pins that behaviour to a test rather than to a reading of the docs.
   */
  it('excludes trigger-modified rows from the changed-row count', () => {
    const { sqlite } = connection;
    sqlite.exec(`
      CREATE TEMP TABLE counter_probe (id INTEGER PRIMARY KEY, touched INTEGER NOT NULL DEFAULT 0);
      CREATE TEMP TRIGGER counter_probe_touch AFTER UPDATE ON counter_probe
      BEGIN UPDATE counter_probe SET touched = OLD.touched + 1 WHERE id = OLD.id; END;
      INSERT INTO counter_probe (id) VALUES (1), (2);
    `);

    const result = sqlite.prepare('UPDATE counter_probe SET touched = touched WHERE id = 1').run();
    const row = sqlite.prepare('SELECT touched FROM counter_probe WHERE id = 1').get() as {
      touched: number;
    };

    expect(result.changes).toBe(1);
    expect(row.touched).toBe(1);

    sqlite.exec('DROP TRIGGER counter_probe_touch; DROP TABLE counter_probe');
  });
});
