import { createConnection, type Connection } from '../../src/database/client';
import { DELETABLE_TABLE_NAMES, PRE_REBUILD_TABLE_NAMES } from '../../src/database/schema';
import { TEST_DB_PATH } from './database';
import { captureSchema, rebuildTables } from './rebuild';

let connection: Connection | undefined;
let schemaStatements: string[] = [];

beforeAll(() => {
  connection = createConnection(TEST_DB_PATH);
  schemaStatements = captureSchema(connection.sqlite);
});

/**
 * FR-017, FR-025c, and Spec 003 FR-102: every test starts from a known empty
 * state, by whichever mechanism each table permits.
 *
 * Three phases, and the order is load-bearing in both directions. Idempotency
 * records reference orders, and SQLite refuses to drop a table while a foreign
 * key still points at it, so they go first. The rebuild then drops the order
 * tables, which releases the references into customers and products, so those
 * can only be cleared afterwards.
 */
beforeEach(() => {
  if (!connection) return;
  for (const table of PRE_REBUILD_TABLE_NAMES) {
    connection.sqlite.exec(`DELETE FROM ${table}`);
  }
  rebuildTables(connection.sqlite, schemaStatements);
  for (const table of DELETABLE_TABLE_NAMES) {
    connection.sqlite.exec(`DELETE FROM ${table}`);
  }
});

// FR-021: resources are released even when a test fails.
afterAll(() => {
  connection?.close();
  connection = undefined;
});
