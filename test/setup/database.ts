import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * FR-018: a throwaway database for the run, never the developer's working one.
 * The path is deterministic rather than randomised so global setup, the tests,
 * and global teardown all agree on it without passing state between Jest
 * contexts.
 */
export const TEST_DB_DIR = join(tmpdir(), 'oms-test');
export const TEST_DB_PATH = join(TEST_DB_DIR, 'oms-test.db');

/** WAL leaves -wal and -shm siblings; all three must go. */
export function removeTestDatabase(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${TEST_DB_PATH}${suffix}`;
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

export function ensureTestDbDir(): void {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
}
