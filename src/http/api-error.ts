import { HttpStatus } from '@nestjs/common';

/**
 * FR-004. Every failure the API can produce, named. A code is part of the
 * contract and a message is not, so callers branch on these and read those.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'CUSTOMER_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'ORDER_NOT_FOUND',
  'ORDER_TOTAL_NOT_REPRESENTABLE',
  'INVALID_CURSOR',
  'INVALID_IDEMPOTENCY_KEY',
  'IDEMPOTENCY_KEY_REUSED',
  'TRANSITION_NOT_PERMITTED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  correlationId: string;
  details: ErrorDetail[];
}

/**
 * The only error type the domain throws. Carrying the status here rather than
 * mapping it in the filter keeps FR-005's closed set of status codes checkable
 * by reading one file.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(code: ErrorCode, message: string, details: ErrorDetail[] = []): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static notFound(code: ErrorCode, message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, code, message);
  }

  static conflict(code: ErrorCode, message: string): ApiError {
    return new ApiError(HttpStatus.CONFLICT, code, message);
  }
}
