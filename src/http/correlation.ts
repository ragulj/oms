import { randomUUID } from 'node:crypto';
import type { HttpRequestLike, HttpResponseLike, NextLike } from './http-types';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Long enough to be useful, short enough that a caller cannot use it as a channel. */
const WELL_FORMED = /^[A-Za-z0-9_.:-]{8,128}$/;

interface Correlated {
  correlationId?: string;
}

/**
 * FR-007. Applied with `app.use` rather than through Nest's route-matching
 * middleware, so it covers every request including ones no controller claims,
 * and so an error raised before routing still carries an identifier.
 */
export function correlationMiddleware(
  req: HttpRequestLike,
  res: HttpResponseLike,
  next: NextLike,
): void {
  const supplied = req.headers[CORRELATION_HEADER];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  const correlationId = candidate && WELL_FORMED.test(candidate) ? candidate : randomUUID();

  (req as HttpRequestLike & Correlated).correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}

/** Never absent in a served request, but a filter may run against a synthetic one. */
export function correlationIdOf(req: unknown): string {
  const value = (req as Correlated | undefined)?.correlationId;
  return typeof value === 'string' ? value : 'unknown';
}
