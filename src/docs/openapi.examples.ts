import { EXAMPLE_CUSTOMER_ID, EXAMPLE_PRODUCT_IDS } from '../database/seed';

/**
 * FR-053. Request examples name the identifiers the seeding command creates, so
 * the first thing a reviewer executes from the page works rather than returning
 * a missing-product error. seed-examples.spec.ts asserts the seed still produces
 * them.
 *
 * FR-030. Response examples are internally consistent: each line total equals
 * unit price times quantity, and each order total equals the sum of the line
 * totals. Response examples are illustrative and are not asserted to correspond
 * to a stored row, because a response example is not something a caller sends.
 *
 * Every money value here is an integer count of minor units and every timestamp
 * an integer count of microseconds. A decimal or a formatted date in this file
 * would be believed, because it appears in the official description of the API,
 * and conventions.spec.ts fails the build if one appears.
 */

const WIDGET_UNIT_PRICE_MINOR = 1299;
const WIDGET_QUANTITY = 3;
const GADGET_UNIT_PRICE_MINOR = 4550;
const GADGET_QUANTITY = 1;

const WIDGET_LINE_TOTAL_MINOR = WIDGET_UNIT_PRICE_MINOR * WIDGET_QUANTITY;
const GADGET_LINE_TOTAL_MINOR = GADGET_UNIT_PRICE_MINOR * GADGET_QUANTITY;
const ORDER_TOTAL_MINOR = WIDGET_LINE_TOTAL_MINOR + GADGET_LINE_TOTAL_MINOR;

const CREATED_AT_US = 1757030400123456;

export const createOrderRequestExample = {
  customerId: EXAMPLE_CUSTOMER_ID,
  lines: [
    { productId: EXAMPLE_PRODUCT_IDS[0], quantity: WIDGET_QUANTITY },
    { productId: EXAMPLE_PRODUCT_IDS[1], quantity: GADGET_QUANTITY },
  ],
};

export const orderViewExample = {
  id: 42,
  customerId: EXAMPLE_CUSTOMER_ID,
  status: 'pending',
  createdAtUs: CREATED_AT_US,
  updatedAtUs: CREATED_AT_US,
  totalMinor: ORDER_TOTAL_MINOR,
  lines: [
    {
      id: 101,
      productId: EXAMPLE_PRODUCT_IDS[0],
      productDescription: 'Widget',
      unitPriceMinor: WIDGET_UNIT_PRICE_MINOR,
      quantity: WIDGET_QUANTITY,
      lineTotalMinor: WIDGET_LINE_TOTAL_MINOR,
    },
    {
      id: 102,
      productId: EXAMPLE_PRODUCT_IDS[1],
      productDescription: 'Gadget',
      unitPriceMinor: GADGET_UNIT_PRICE_MINOR,
      quantity: GADGET_QUANTITY,
      lineTotalMinor: GADGET_LINE_TOTAL_MINOR,
    },
  ],
};

export const cancelledOrderViewExample = {
  ...orderViewExample,
  status: 'cancelled',
  updatedAtUs: CREATED_AT_US + 1,
};

export const listOrdersResponseExample = {
  orders: [orderViewExample],
  nextCursor: null,
  limit: 50,
};

export const validationErrorExample = {
  code: 'VALIDATION_FAILED',
  message: 'The request body is not valid.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [{ field: 'lines.0.quantity', message: 'quantity must be at least 1' }],
};

export const customerNotFoundExample = {
  code: 'CUSTOMER_NOT_FOUND',
  message: 'No customer exists with identifier 9999.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const orderTotalNotRepresentableExample = {
  code: 'ORDER_TOTAL_NOT_REPRESENTABLE',
  message: 'The order total is larger than can be represented exactly and was not rounded.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const invalidIdempotencyKeyExample = {
  code: 'INVALID_IDEMPOTENCY_KEY',
  message:
    'The Idempotency-Key header must be 8 to 255 characters of A-Z, a-z, 0-9, hyphen or underscore.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const productNotFoundExample = {
  code: 'PRODUCT_NOT_FOUND',
  message: 'No product exists with identifier 9999.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const orderNotFoundExample = {
  code: 'ORDER_NOT_FOUND',
  message: 'No order exists with identifier 9999.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const transitionNotPermittedExample = {
  code: 'TRANSITION_NOT_PERMITTED',
  message: 'Order 42 is cancelled and cannot be cancelled.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const idempotencyKeyReusedExample = {
  code: 'IDEMPOTENCY_KEY_REUSED',
  message: 'This idempotency key was used before with a different request body.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const invalidCursorExample = {
  code: 'INVALID_CURSOR',
  message: 'The cursor is malformed.',
  correlationId: '0f6c8a5e-3d21-4c77-9f0e-2b6a1d4e8c11',
  details: [],
};

export const healthyReportExample = {
  status: 'healthy',
  dependencies: { database: 'healthy' },
};

export const unhealthyReportExample = {
  status: 'unhealthy',
  dependencies: { database: 'unhealthy' },
};
