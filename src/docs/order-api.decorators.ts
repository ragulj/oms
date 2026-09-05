import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { ErrorCode } from '../http/api-error';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '../database/schema/idempotency-records';
import { MAX_LINES_PER_ORDER, MAX_QUANTITY } from '../orders/order.schemas';
import {
  buildListQueryParameterSchemas,
  componentRef,
  PAGE_SIZE_DOCUMENTATION,
} from './openapi.schemas';
import {
  cancelledOrderViewExample,
  createOrderRequestExample,
  customerNotFoundExample,
  idempotencyKeyReusedExample,
  invalidCursorExample,
  invalidIdempotencyKeyExample,
  listOrdersResponseExample,
  orderNotFoundExample,
  orderTotalNotRepresentableExample,
  orderViewExample,
  productNotFoundExample,
  transitionNotPermittedExample,
  validationErrorExample,
} from './openapi.examples';

/**
 * FR-006, FR-032, FR-034. One composed decorator per operation, so the
 * controller reads as a controller and every documentation decision lives here,
 * where the mutation sweep can reach it.
 *
 * Operation identifiers are set explicitly. The framework's default is
 * `OrdersController_create`, which publishes an internal class name as part of a
 * public contract and would change if the class were renamed (research R6).
 */

const CORRELATION_RESPONSE_HEADER = {
  'X-Correlation-Id': {
    description: 'Identifies this request in the service logs. Present on success and failure.',
    schema: { type: 'string' as const },
  },
};

/**
 * FR-034. The codes an operation can emit are published as named examples, one
 * per code, rather than only as prose. That makes them useful on the page and
 * checkable by failure-documentation.spec.ts in the same move; a sentence naming
 * codes would be neither.
 */
function errorResponse(
  status: number,
  description: string,
  examples: Partial<Record<ErrorCode, unknown>>,
): MethodDecorator & ClassDecorator {
  return ApiResponse({
    status,
    description,
    headers: CORRELATION_RESPONSE_HEADER,
    content: {
      'application/json': {
        schema: { $ref: componentRef('ErrorBody') },
        examples: Object.fromEntries(
          Object.entries(examples).map(([code, value]) => [code, { value }]),
        ),
      },
    },
  });
}

export function ApiCreateOrder(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'createOrder',
      summary: 'Place an order',
      description: [
        'Captures the catalog price of every product at this moment and stores the order and all of its',
        'line items as one indivisible unit. Nothing you send can influence the price recorded: a request',
        'carrying a price, a total, a status, an identifier or a timestamp is rejected rather than having',
        'the field ignored.',
        '',
        'Without an `Idempotency-Key` there is no replay protection, so executing this twice creates two',
        'orders. That is the intended behaviour, not a defect: the key is the mechanism that prevents a',
        'duplicate, and a duplicate cannot be deleted afterwards, only cancelled.',
      ].join('\n'),
    }),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description: [
        `${IDEMPOTENCY_KEY_MIN_LENGTH} to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters of letters, digits,`,
        'hyphen and underscore. Repeating a request with the same key returns the originally created',
        'order with status 200 instead of creating a second one. Omitting it means no replay protection.',
      ].join(' '),
      schema: {
        type: 'string',
        minLength: IDEMPOTENCY_KEY_MIN_LENGTH,
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
      },
    }),
    ApiHeader({
      name: 'X-Correlation-Id',
      required: false,
      description:
        'Echoed back when well formed. A generated identifier is used when absent or malformed.',
      schema: { type: 'string' },
    }),
    ApiBody({
      description: `One to ${MAX_LINES_PER_ORDER} line items. Repeating a product across lines is permitted; each line is priced and totalled independently.`,
      required: true,
      schema: { $ref: componentRef('CreateOrderRequest') },
      examples: { default: { value: createOrderRequestExample } },
    }),
    ApiResponse({
      status: 201,
      description: 'The order was created.',
      headers: {
        ...CORRELATION_RESPONSE_HEADER,
        Location: {
          description: 'Path at which the created order can be retrieved.',
          schema: { type: 'string' },
        },
      },
      content: {
        'application/json': {
          schema: { $ref: componentRef('OrderView') },
          example: orderViewExample,
        },
      },
    }),
    ApiResponse({
      status: 200,
      description:
        'An idempotent replay. The body is the order created by the original request, and no second order exists. The status code is the signal, since the body is identical to the original 201.',
      headers: {
        ...CORRELATION_RESPONSE_HEADER,
        'Idempotent-Replay': {
          description: 'Present and set to true only on a replay.',
          schema: { type: 'string', enum: ['true'] },
        },
      },
      content: {
        'application/json': {
          schema: { $ref: componentRef('OrderView') },
          example: orderViewExample,
        },
      },
    }),
    errorResponse(
      400,
      `The request is not valid, or an identifier does not resolve. Nothing is written, not even the order row. Quantity must be between 1 and ${MAX_QUANTITY}, and an order must carry 1 to ${MAX_LINES_PER_ORDER} lines.`,
      {
        VALIDATION_FAILED: validationErrorExample,
        CUSTOMER_NOT_FOUND: customerNotFoundExample,
        PRODUCT_NOT_FOUND: productNotFoundExample,
        ORDER_TOTAL_NOT_REPRESENTABLE: orderTotalNotRepresentableExample,
        INVALID_IDEMPOTENCY_KEY: invalidIdempotencyKeyExample,
      },
    ),
    errorResponse(
      409,
      'The idempotency key was used before with a different request body. Nothing is written.',
      { IDEMPOTENCY_KEY_REUSED: idempotencyKeyReusedExample },
    ),
  );
}

export function ApiGetOrder(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'getOrder',
      summary: 'Retrieve an order',
      description:
        'Returns the complete order: its status, its timestamps, every line item with the price captured at placement, and the total derived from those lines.',
    }),
    ApiParam({
      name: 'id',
      description: 'Identifier of the order.',
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiResponse({
      status: 200,
      description:
        'The order exists and is returned in full, with every line item and a derived total.',
      headers: CORRELATION_RESPONSE_HEADER,
      content: {
        'application/json': {
          schema: { $ref: componentRef('OrderView') },
          example: orderViewExample,
        },
      },
    }),
    errorResponse(
      400,
      'The identifier is not a positive integer. A non-numeric identifier is a malformed request rather than a missing resource, which is why this is 400 and not 404.',
      { VALIDATION_FAILED: validationErrorExample },
    ),
    errorResponse(404, 'No order exists with that identifier.', {
      ORDER_NOT_FOUND: orderNotFoundExample,
    }),
  );
}

export function ApiListOrders(): MethodDecorator & ClassDecorator {
  const query = buildListQueryParameterSchemas();

  return applyDecorators(
    ApiOperation({
      operationId: 'listOrders',
      summary: 'List orders, newest first',
      description: [
        'Keyset pagination only. Read `nextCursor` from the response and pass it back unchanged to fetch',
        'the next page; it is null on the final page. Passing the same cursor twice with no intervening',
        'writes returns the same page.',
        '',
        'There is no `offset` or `page` parameter, and supplying one is rejected rather than ignored:',
        'accepting an offset while ignoring it would let a caller believe it was paging when it was',
        're-reading the first page. Changing `status` mid-traversal starts a new listing, because the',
        'filter applies to the whole set and the cursor only positions within it.',
      ].join('\n'),
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      description: `Page size, ${PAGE_SIZE_DOCUMENTATION.default} by default and at most ${PAGE_SIZE_DOCUMENTATION.maximum}. A value outside the range is rejected, never clamped, so you never receive fewer items than you asked for without being told.`,
      schema: query.limit,
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      description:
        'Opaque continuation token from a previous response. Its encoding is not part of this contract: do not decode it and do not construct one. A malformed cursor is rejected rather than treated as absent.',
      schema: query.cursor,
    }),
    ApiQuery({
      name: 'status',
      required: false,
      description: 'Restrict the listing to one status.',
      schema: query.status,
    }),
    ApiResponse({
      status: 200,
      description: 'A page of orders. Returned for an empty page too.',
      headers: CORRELATION_RESPONSE_HEADER,
      content: {
        'application/json': {
          schema: { $ref: componentRef('ListOrdersResponse') },
          example: listOrdersResponseExample,
        },
      },
    }),
    errorResponse(
      400,
      'A parameter is out of range, unrecognised, or malformed, including the cursor.',
      { VALIDATION_FAILED: validationErrorExample, INVALID_CURSOR: invalidCursorExample },
    ),
  );
}

export function ApiCancelOrder(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiOperation({
      operationId: 'cancelOrder',
      summary: 'Cancel a pending order',
      description: [
        'Takes no request body. This is the only status change a caller can request; promotion to',
        '`processing` belongs to the background job alone, and there is no operation that sets an',
        'arbitrary status.',
        '',
        'A conflict means the order is not in a state from which cancellation is legal. It is returned',
        'both when the caller was simply late and when the transition was never legal from that state,',
        'because those are the same fact and telling them apart would require a read-then-write guard',
        'that this system does not use.',
      ].join('\n'),
    }),
    ApiParam({
      name: 'id',
      description: 'Identifier of the order to cancel.',
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiResponse({
      status: 200,
      description: 'The order was pending and is now cancelled.',
      headers: CORRELATION_RESPONSE_HEADER,
      content: {
        'application/json': {
          schema: { $ref: componentRef('OrderView') },
          example: cancelledOrderViewExample,
        },
      },
    }),
    errorResponse(400, 'The identifier is not a positive integer.', {
      VALIDATION_FAILED: validationErrorExample,
    }),
    errorResponse(404, 'No order exists with that identifier.', {
      ORDER_NOT_FOUND: orderNotFoundExample,
    }),
    errorResponse(
      409,
      'The order is already processing or already cancelled, so cancellation is not a legal transition from its current state.',
      { TRANSITION_NOT_PERMITTED: transitionNotPermittedExample },
    ),
  );
}
