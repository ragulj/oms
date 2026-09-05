import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { componentRef } from './openapi.schemas';
import { healthyReportExample, unhealthyReportExample } from './openapi.examples';

/**
 * FR-003, FR-040. Documented at `/health`, outside the `/api/v1` prefix every
 * order operation carries. A document that listed it under the prefix would be
 * wrong in a way that costs a reader a real debugging session, and the
 * playground would exercise a path that returns 404.
 *
 * The 503 is the one status outside the order API's closed set of 200, 201, 400,
 * 404, 409 and 500. It is admitted explicitly rather than by relaxing the rule
 * that keeps undocumented statuses out.
 */
export function ApiHealthCheck(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'checkHealth',
      summary: 'Report service and dependency health',
      description: [
        'Succeeds only when the service and every dependency are healthy. There is deliberately no',
        'liveness and readiness split, since the declared scope has no orchestrator to consume one.',
        '',
        'This endpoint sits outside the versioned prefix on purpose, so a supervisor or probe never has',
        'to track the API version.',
      ].join('\n'),
    }),
    ApiResponse({
      status: 200,
      description: 'The service and every dependency are healthy.',
      content: {
        'application/json': {
          schema: { $ref: componentRef('HealthReport') },
          example: healthyReportExample,
        },
      },
    }),
    ApiResponse({
      status: 503,
      description:
        'At least one dependency is unhealthy. The body names which. This response does not use the shared error body, because health reports a state rather than rejecting a request.',
      content: {
        'application/json': {
          schema: { $ref: componentRef('HealthReport') },
          example: unhealthyReportExample,
        },
      },
    }),
  );
}
