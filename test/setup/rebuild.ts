import type Database from 'better-sqlite3';
import { REBUILT_TABLE_NAMES } from '../../src/database/schema';

interface SchemaObject {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

/**
 * FR-025c. The immutability triggers refuse row deletion on these tables, so
 * isolation is achieved by rebuilding them. Constitution Principle VI requires
 * `DELETE FROM` wherever it still works and a rebuild only where it does not,
 * which is why this applies to two tables rather than to the whole suite.
 *
 * The DDL is read back out of the database rather than written here. A second
 * copy of the schema in test code is a copy that drifts from the migration, and
 * a rebuild that drifts would quietly test a different shape than production
 * runs.
 */
export function captureSchema(sqlite: Database.Database): string[] {
  const names = REBUILT_TABLE_NAMES.join("', '");
  const rows = sqlite
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND tbl_name IN ('${names}')`,
    )
    .all() as SchemaObject[];

  if (rows.length === 0) {
    throw new Error(
      `No schema found for ${REBUILT_TABLE_NAMES.join(', ')}. Migrations may not have run.`,
    );
  }

  // Parent table before child, because the child declares a foreign key against
  // it. SQLite resolves foreign key targets at write time rather than at DDL
  // time, so the reverse order would also succeed today, which is exactly why
  // it is worth being explicit instead of depending on that.
  const creationOrder: string[] = [...REBUILT_TABLE_NAMES].reverse();
  const rank = (row: SchemaObject): number =>
    (row.type === 'table' ? 0 : 10) + creationOrder.indexOf(row.tbl_name);

  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((r) => r.sql);
}

/**
 * Dropping a table takes its indexes and triggers with it, so all three are
 * recreated together from the captured statements.
 */
export function rebuildTables(sqlite: Database.Database, statements: string[]): void {
  // Child before parent on the way down.
  for (const table of REBUILT_TABLE_NAMES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  for (const statement of statements) {
    sqlite.exec(statement);
  }
}
