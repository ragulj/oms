import { createConnection, type Connection } from '../../src/database/client';
import { harnessProbe } from '../../src/database/schema';
import { TEST_DB_PATH } from '../setup/database';

/**
 * User Story 3, scenario 1. These two tests are order-dependent by design: the
 * first writes rows, and the second proves the beforeEach cleanup removed them.
 * If the harness ever stops clearing state, the second test fails.
 */
describe('per-test isolation', () => {
  let connection: Connection;

  beforeAll(() => {
    connection = createConnection(TEST_DB_PATH);
  });

  afterAll(() => {
    connection.close();
  });

  it('a test can insert rows', () => {
    connection.db
      .insert(harnessProbe)
      .values({ note: 'inserted by the first test', createdAtUs: Date.now() * 1000 })
      .run();

    expect(connection.db.select().from(harnessProbe).all()).toHaveLength(1);
  });

  it('the next test observes an empty starting state', () => {
    expect(connection.db.select().from(harnessProbe).all()).toHaveLength(0);
  });
});
