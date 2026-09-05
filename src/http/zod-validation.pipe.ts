import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError } from './api-error';

/**
 * FR-002 and FR-003. Every schema this is used with must be a strict object:
 * a plain zod object silently discards unknown keys and reports success, so a
 * caller sending a field it believes it controls would receive a 201 for a
 * request that was quietly rewritten. See research R1.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    throw ApiError.badRequest(
      'VALIDATION_FAILED',
      'The request body or query string is not valid.',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
}
