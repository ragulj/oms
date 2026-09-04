import { createConnection, type Connection } from '../../src/database/client';
import { DELETABLE_TABLE_NAMES } from '../../src/database/schema';
import { TEST_DB_PATH } from './database';
import { captureSchema, rebuildTables } from './rebuild';

let connection: Connection | undefined;
let schemaStatements: string[] = [];

beforeAll(() => {
  connection = createConnection(TEST_DB_PATH);
  schemaStatements = captureSchema(connection.sqlite);
});

/**
 * FR-017 and FR-025c: every test starts from a known empty state, by whichever
 * mechanism the table permits.
 *
 * The rebuild runs first. It drops the order tables, which is what releases the
 * foreign key references into customers and products and lets those be cleared
 * by deletion straight after.
 */
beforeEach(() => {
  if (!connection) return;
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
