import { Injectable, type PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error';

/**
 * FR-039. An identifier that is not a positive whole number is a malformed
 * request, not a missing resource, so this produces 400 rather than letting the
 * lookup fall through to 404.
 */
@Injectable()
export class PositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[0-9]+$/.test(value)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'The identifier must be a positive integer.', [
        { field: 'id', message: `"${value}" is not a positive integer.` },
      ]);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'The identifier must be a positive integer.', [
        { field: 'id', message: `"${value}" is out of range.` },
      ]);
    }

    return parsed;
  }
}
