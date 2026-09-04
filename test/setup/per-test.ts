import { createConnection, type Connection } from '../../src/database/client';
import { ALL_TABLE_NAMES } from '../../src/database/schema';
import { TEST_DB_PATH } from './database';

let connection: Connection | undefined;

beforeAll(() => {
  connection = createConnection(TEST_DB_PATH);
});

/**
 * FR-017: every test starts from a known empty state. DELETE FROM rather than
 * TRUNCATE, which SQLite does not have (Constitution VI).
 */
beforeEach(() => {
  for (const table of ALL_TABLE_NAMES) {
    connection?.sqlite.exec(`DELETE FROM ${table}`);
  }
});

// FR-021: resources are released even when a test fails.
afterAll(() => {
  connection?.close();
  connection = undefined;
});
