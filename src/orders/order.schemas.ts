import { z } from 'zod';
import { ORDER_STATUSES } from '../database/schema';

/** FR-014, FR-015, FR-046: the documented bounds, in one place. */
export const MAX_QUANTITY = 1_000_000;
export const MAX_LINES_PER_ORDER = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const positiveId = (label: string) =>
  z
    .number({ message: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .positive(`${label} must be greater than zero`)
    .max(Number.MAX_SAFE_INTEGER);

/**
 * `strictObject`, not `object`, at every level. A plain zod object silently
 * discards unknown keys and reports success, so a caller sending
 * `unitPriceMinor` would receive a 201 for a request whose price field was
 * thrown away. FR-003 requires rejection; research R1 has the measurement.
 */
const createOrderLineSchema = z.strictObject({
  productId: positiveId('productId'),
  quantity: z
    .number({ message: 'quantity must be a number' })
    .int('quantity must be a whole number')
    .min(1, 'quantity must be at least 1')
    .max(MAX_QUANTITY, `quantity must be at most ${MAX_QUANTITY}`),
});

export const createOrderSchema = z.strictObject({
  customerId: positiveId('customerId'),
  lines: z
    .array(createOrderLineSchema)
    .min(1, 'an order must have at least one line item')
    .max(MAX_LINES_PER_ORDER, `an order must have at most ${MAX_LINES_PER_ORDER} line items`),
});

export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

/**
 * FR-046 and FR-047. `limit` out of range is rejected rather than clamped, so a
 * caller never believes it received more than it did. `offset` and `page` are
 * not merely unsupported: they are rejected by strictness, because accepting one
 * while ignoring it would let a caller believe it was paging when it was
 * re-reading page one.
 */
export const listOrdersSchema = z.strictObject({
  limit: z.coerce
    .number({ message: 'limit must be a number' })
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(MAX_PAGE_SIZE, `limit must be at most ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;
