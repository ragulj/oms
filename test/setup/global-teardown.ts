import { removeTestDatabase } from './database';

/** FR-018: the throwaway database is removed when the run ends. */
export default function globalTeardown(): void {
  removeTestDatabase();
}
