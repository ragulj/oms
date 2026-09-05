import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConnection,
  DatabaseUnavailableError,
  type Connection,
} from '../../src/database/client';

/**
 * Spec 006 FR-006..FR-010, FR-018..FR-020, FR-022. createConnection must ensure
 * the directory holding the database file exists before opening it, so a fresh
 * checkout — whose data directory is gitignored and therefore absent — starts
 * without a manual mkdir. Exercised against a real database per Principle VI,
 * in a throwaway workspace that is removed after each test so nothing leaks.
 */
describe('createConnection ensures the runtime data directory', () => {
  let workspace: string;
  const opened: Connection[] = [];

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'oms-dir-'));
  });

  afterEach(() => {
    for (const connection of opened.splice(0)) {
      connection.close();
    }
    rmSync(workspace, { recursive: true, force: true });
  });

  const open = (databasePath: string): Connection => {
    const connection = createConnection(databasePath);
    opened.push(connection);
    return connection;
  };

  it('creates a missing directory, including parents, then opens the database (FR-006)', () => {
    const directory = join(workspace, 'nested', 'data');
    expect(existsSync(directory)).toBe(false);

    const connection = open(join(directory, 'oms.db'));

    expect(existsSync(directory)).toBe(true);
    expect(connection.sqlite.open).toBe(true);
  });

  it('is idempotent and leaves an existing directory and its contents untouched (FR-007)', () => {
    const directory = join(workspace, 'data');
    mkdirSync(directory, { recursive: true });
    const sentinel = join(directory, 'keep.txt');
    writeFileSync(sentinel, 'preserve me');

    const connection = open(join(directory, 'oms.db'));

    expect(connection.sqlite.open).toBe(true);
    expect(readFileSync(sentinel, 'utf8')).toBe('preserve me');
  });

  it('creates no directory for an in-memory database (FR-008)', () => {
    const before = readdirSync(workspace);

    const connection = open(':memory:');

    expect(connection.sqlite.open).toBe(true);
    // Nothing was written into the controlled workspace for an in-memory path.
    expect(readdirSync(workspace)).toEqual(before);
  });

  it('surfaces an uncreatable directory as DatabaseUnavailableError (FR-009)', () => {
    // A regular file sits where the directory must be, so creating it must fail.
    const fileWhereDirectoryShouldBe = join(workspace, 'not-a-dir');
    writeFileSync(fileWhereDirectoryShouldBe, '');

    expect(() => open(join(fileWhereDirectoryShouldBe, 'oms.db'))).toThrow(
      DatabaseUnavailableError,
    );
  });
});
