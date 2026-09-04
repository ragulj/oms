import { createConnection, type Connection } from '../../src/database/client';
import { harnessProbe } from '../../src/database/schema';
import { TEST_DB_PATH } from '../setup/database';

/**
 * User Story 3, scenario 2 and FR-020. Each test asserts an empty start and then
 * writes, so the outcome is identical whether the file runs alone or inside the
 * full suite, in any order. No assertion here depends on a global row count.
 */
describe('order independence', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  const writeAndCount = (note: string): number => {
    connection.db
      .insert(harnessProbe)
      .values({ note, createdAtUs: Date.now() * 1000 })
      .run();
    return connection.db.select().from(harnessProbe).all().length;
  };

  it('starts empty and ends with exactly its own row (first)', () => {
    expect(connection.db.select().from(harnessProbe).all()).toHaveLength(0);
    expect(writeAndCount('first')).toBe(1);
  });

  it('starts empty and ends with exactly its own row (second)', () => {
    expect(connection.db.select().from(harnessProbe).all()).toHaveLength(0);
    expect(writeAndCount('second')).toBe(1);
  });
});
