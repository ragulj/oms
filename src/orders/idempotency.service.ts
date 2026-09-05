import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Connection } from '../database/client';
import {
  idempotencyRecords,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
} from '../database/schema';
import { ApiError } from '../http/api-error';

export interface IdempotencyRecord {
  idempotencyKey: string;
  requestFingerprint: string;
  orderId: number;
}

/** better-sqlite3 sets this on the error; the message names the table and drifts. */
const UNIQUE_VIOLATION = 'SQLITE_CONSTRAINT_UNIQUE';

@Injectable()
export class IdempotencyService {
  /** FR-030. Rejected before anything is read or written. */
  assertKeyWellFormed(key: string): void {
    const valid =
      key.length >= IDEMPOTENCY_KEY_MIN_LENGTH &&
      key.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
      IDEMPOTENCY_KEY_PATTERN.test(key);

    if (!valid) {
      throw ApiError.badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'The Idempotency-Key header is not valid.',
        [
          {
            field: 'Idempotency-Key',
            message: `Use ${IDEMPOTENCY_KEY_MIN_LENGTH} to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters of A-Z, a-z, 0-9, hyphen, or underscore.`,
          },
        ],
      );
    }
  }

  /**
   * FR-030a. Hashed over a canonical form, with object keys ordered at every
   * depth, so two byte-different serialisations of the same request compare
   * equal. Matching raw bytes would make a client that re-serialises its body on
   * retry, which most HTTP clients do, look like a key collision.
   */
  fingerprint(body: unknown): string {
    return createHash('sha256').update(canonicalise(body)).digest('hex');
  }

  find(connection: Connection, key: string): IdempotencyRecord | undefined {
    const [row] = connection.db
      .select({
        idempotencyKey: idempotencyRecords.idempotencyKey,
        requestFingerprint: idempotencyRecords.requestFingerprint,
        orderId: idempotencyRecords.orderId,
      })
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.idempotencyKey, key))
      .all();

    return row;
  }

  /**
   * FR-032, FR-033. A replay carrying a different request is a conflict, not an
   * excuse to return an order the caller did not ask for.
   */
  assertFingerprintMatches(record: IdempotencyRecord, fingerprint: string): void {
    if (record.requestFingerprint !== fingerprint) {
      throw ApiError.conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request.',
      );
    }
  }

  /** FR-034: the race is settled here, by the unique constraint, not by `find`. */
  isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION
    );
  }
}

/** Recursive: line items are nested objects, so ordering only the top level would not do it. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalise(entry)}`);
  return `{${entries.join(',')}}`;
}
