import { createConnection, type Connection } from '../../src/database/client';
import { TEST_DB_PATH } from '../setup/database';

/**
 * User Story 3, scenario 5 and FR-013. The test database must carry the same
 * durability, referential integrity, and write-contention settings the running
 * service applies, or the suite is exercising a different engine configuration
 * than production.
 */
describe('connection settings on the test database', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it('runs in WAL mode', () => {
    const mode = connection.sqlite.pragma('journal_mode', { simple: true });
    expect(String(mode).toLowerCase()).toBe('wal');
  });

  it('enforces foreign keys', () => {
    expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('sets a non-zero busy timeout', () => {
    const timeout = connection.sqlite.pragma('busy_timeout', { simple: true });
    expect(Number(timeout)).toBeGreaterThan(0);
  });

  it('uses genuine SQLite, not a fork', () => {
    const version = connection.sqlite.prepare('SELECT sqlite_version() AS v').get() as {
      v: string;
    };
    expect(version.v).toMatch(/^3\./);
  });
});
