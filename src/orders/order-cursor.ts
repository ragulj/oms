import { ApiError } from '../http/api-error';

export interface OrderCursor {
  createdAtUs: number;
  id: number;
}

/**
 * Constitution Principle V, and FR-048 to FR-050.
 *
 * Carries the full microsecond value and the unique tiebreaker, and nothing
 * else. Encoded so callers treat it as opaque and no client builds one by hand
 * from a timestamp it read off a response.
 *
 * Never round-tripped through a Date. The encoding is decimal text inside
 * base64url, so the integer that goes in is the integer that comes out.
 */
export function encodeCursor(cursor: OrderCursor): string {
  return Buffer.from(`${cursor.createdAtUs}.${cursor.id}`, 'utf8').toString('base64url');
}

/**
 * FR-050. A token that does not decode is rejected, never treated as an absent
 * cursor: silently restarting the traversal at page one would look to a caller
 * exactly like a page of results.
 */
export function decodeCursor(token: string): OrderCursor {
  const reject = (): never => {
    throw ApiError.badRequest('INVALID_CURSOR', 'The cursor is not valid.', [
      { field: 'cursor', message: 'Use the nextCursor value from a previous page.' },
    ]);
  };

  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return reject();
  }

  const parts = decoded.split('.');
  if (parts.length !== 2) {
    return reject();
  }

  const [rawCreatedAtUs, rawId] = parts;
  if (!isPositiveIntegerText(rawCreatedAtUs) || !isPositiveIntegerText(rawId)) {
    return reject();
  }

  const createdAtUs = Number(rawCreatedAtUs);
  const id = Number(rawId);
  if (!Number.isSafeInteger(createdAtUs) || !Number.isSafeInteger(id)) {
    return reject();
  }

  return { createdAtUs, id };
}

function isPositiveIntegerText(value: string | undefined): value is string {
  return value !== undefined && /^[0-9]+$/.test(value) && value.length <= 16;
}
