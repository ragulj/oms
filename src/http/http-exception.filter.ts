import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { HttpRequestLike, HttpResponseLike } from './http-types';
import type { StructuredLogger } from '../logging/logger';
import { LOGGER } from '../tokens';
import { ApiError, type ErrorBody, type ErrorCode } from './api-error';
import { correlationIdOf } from './correlation';

/**
 * FR-004 to FR-006 and FR-098. One body shape for every failure, and the only
 * place a thrown error becomes a response.
 *
 * Anything that is not an ApiError becomes a 500 with a fixed message. That is
 * deliberate: an unexpected error's own message is the most likely carrier of a
 * SQL fragment, a driver detail, or a filesystem path, and FR-006 forbids all
 * three from reaching a caller. The real message goes to the log instead.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();
    const correlationId = correlationIdOf(request);

    const { status, code, message, details } = classify(exception);

    const body: ErrorBody = { code, message, correlationId, details };

    // FR-098: a caller's fault is a warning, an unexpected fault is an error.
    // FR-100: the route and the code, never the body and never the headers.
    this.logger.emit(
      status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'warn',
      'request.failed',
      {
        correlationId,
        method: request.method,
        route: request.path,
        status,
        code,
        // Only present for a 500, and only what the operator needs to find it.
        ...(status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? { detail: exception instanceof Error ? exception.message : String(exception) }
          : {}),
      },
    );

    response.status(status).json(body);
  }
}

interface Classified {
  status: number;
  code: ErrorCode;
  message: string;
  details: ErrorBody['details'];
}

function classify(exception: unknown): Classified {
  if (exception instanceof ApiError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  // Nest raises these itself for an unmatched route or an unsupported method.
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code: status === HttpStatus.NOT_FOUND ? 'ORDER_NOT_FOUND' : 'VALIDATION_FAILED',
      message:
        status === HttpStatus.NOT_FOUND ? 'No such route.' : 'The request could not be processed.',
      details: [],
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
    details: [],
  };
}
