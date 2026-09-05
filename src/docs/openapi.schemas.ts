import { z } from 'zod';
import { ERROR_CODES } from '../http/api-error';
import { ORDER_STATUSES } from '../database/schema';
import {
  createOrderSchema,
  listOrdersSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../orders/order.schemas';

export const SCHEMA_REF_PREFIX = '#/components/schemas/';

/**
 * FR-008, FR-010. Request schemas are the live validation schemas, not copies.
 * Every bound in the published document therefore arrives from the constant the
 * service enforces, and `additionalProperties: false` arrives because Spec 003
 * used a strict object. Nothing about a request is retyped here, so nothing
 * about a request can drift (research R1).
 *
 * Response schemas are declared here because `OrderView` and its siblings are
 * TypeScript interfaces, erased at runtime with nothing to derive from. They are
 * a second description of a shape, which is permitted only because it is an
 * executable one: response-conformance.spec.ts parses every real response
 * through them, so they cannot silently disagree with the implementation
 * (research R10).
 */

const money = (description: string) =>
  z.int().min(0).max(Number.MAX_SAFE_INTEGER).describe(description);

const microseconds = (description: string) =>
  z.int().positive().max(Number.MAX_SAFE_INTEGER).describe(description);

const identifier = (description: string) => z.int().positive().describe(description);

export const orderStatusSchema = z
  .enum(ORDER_STATUSES)
  .describe('The lifecycle state of an order. Only pending orders can be promoted or cancelled.');

export const orderLineViewSchema = z.strictObject({
  id: identifier('Identifier of this line item, stable across reads.'),
  productId: identifier('The product this line was placed against.'),
  productDescription: z
    .string()
    .describe('The product description captured when the order was placed.'),
  unitPriceMinor: money(
    'The catalog price at the moment of placement, in minor units. Unaffected by later catalog changes.',
  ),
  quantity: z.int().positive().describe('How many units of the product this line covers.'),
  lineTotalMinor: money(
    'Unit price times quantity, in minor units. Computed by the database, never supplied by a caller.',
  ).meta({ readOnly: true }),
});

export const orderViewSchema = z.strictObject({
  id: identifier('Identifier of the order.'),
  customerId: identifier('The customer the order was placed for.'),
  status: orderStatusSchema,
  createdAtUs: microseconds('When the order was created, in microseconds since the Unix epoch.'),
  updatedAtUs: microseconds(
    'When the order last changed, in microseconds since the Unix epoch. Never earlier than createdAtUs.',
  ),
  totalMinor: money(
    'The sum of the line totals, in minor units. Derived on read and never stored.',
  ).meta({ readOnly: true }),
  lines: z
    .array(orderLineViewSchema)
    .min(1)
    .describe(
      'Never empty, because an order and at least one line are written in one transaction. Returned in ascending line identifier, which is stable across reads.',
    ),
});

export const listOrdersResponseSchema = z.strictObject({
  orders: z.array(orderViewSchema).describe('The page of orders, newest first.'),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      'Opaque continuation token. Pass it back as the cursor parameter to fetch the next page. Null on the final page. Its encoding is not part of this contract and must not be decoded or constructed.',
    ),
  limit: z.int().describe('The page size that was applied.'),
});

export const errorDetailSchema = z.strictObject({
  field: z.string().describe('The request field the problem concerns.'),
  message: z.string().describe('What is wrong with it.'),
});

export const errorBodySchema = z.strictObject({
  code: z
    .enum(ERROR_CODES)
    .describe(
      'Stable and machine-readable. Branch on this rather than on the message, which is for a human and is not part of the contract.',
    ),
  message: z
    .string()
    .describe(
      'Human-readable explanation. Never contains a stack trace, a driver message, a query fragment or a filesystem path.',
    ),
  correlationId: z.string().describe('Identifies this request in the service logs.'),
  details: z
    .array(errorDetailSchema)
    .describe('Per-field problems on a validation failure, and an empty array otherwise.'),
});

export const healthReportSchema = z.strictObject({
  status: z.enum(['healthy', 'unhealthy']).describe('Healthy only when every dependency is.'),
  dependencies: z
    .record(z.string(), z.enum(['healthy', 'unhealthy']))
    .describe('One entry per checked dependency.'),
});

/** data-model.md names these. They are the public identity of each component. */
export const COMPONENT_IDS = {
  CreateOrderRequest: 'CreateOrderRequest',
  OrderStatus: 'OrderStatus',
  OrderLineView: 'OrderLineView',
  OrderView: 'OrderView',
  ListOrdersResponse: 'ListOrdersResponse',
  ErrorDetail: 'ErrorDetail',
  ErrorBody: 'ErrorBody',
  HealthReport: 'HealthReport',
} as const;

export type ComponentId = keyof typeof COMPONENT_IDS;

export const componentRef = (id: ComponentId): string => `${SCHEMA_REF_PREFIX}${id}`;

const registry = z.registry<{ id: string }>();
registry.add(createOrderSchema, { id: COMPONENT_IDS.CreateOrderRequest });
registry.add(orderStatusSchema, { id: COMPONENT_IDS.OrderStatus });
registry.add(orderLineViewSchema, { id: COMPONENT_IDS.OrderLineView });
registry.add(orderViewSchema, { id: COMPONENT_IDS.OrderView });
registry.add(listOrdersResponseSchema, { id: COMPONENT_IDS.ListOrdersResponse });
registry.add(errorDetailSchema, { id: COMPONENT_IDS.ErrorDetail });
registry.add(errorBodySchema, { id: COMPONENT_IDS.ErrorBody });
registry.add(healthReportSchema, { id: COMPONENT_IDS.HealthReport });

export type JsonSchemaObject = Record<string, unknown>;

/**
 * `$schema` and `$id` are JSON Schema document members that an OpenAPI schema
 * object must not carry. zod emits both, the second only when a `uri` mapping is
 * supplied, which is the same option that turns a reused subschema into a `$ref`
 * instead of an inlined copy (research R1). Stripping them is not cosmetic: they
 * would otherwise appear in the committed export and in every diff of it.
 */
const JSON_SCHEMA_ONLY_MEMBERS = ['$schema', '$id'] as const;

function stripJsonSchemaMembers(schema: JsonSchemaObject): JsonSchemaObject {
  return Object.fromEntries(
    Object.entries(schema).filter(
      ([key]) => !(JSON_SCHEMA_ONLY_MEMBERS as readonly string[]).includes(key),
    ),
  );
}

/** The complete `components.schemas` map, with every cross-reference resolved. */
export function buildComponentSchemas(): Record<string, JsonSchemaObject> {
  const converted = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `${SCHEMA_REF_PREFIX}${id}`,
  }) as { schemas: Record<string, JsonSchemaObject> };

  return Object.fromEntries(
    Object.entries(converted.schemas).map(([id, schema]) => [id, stripJsonSchemaMembers(schema)]),
  );
}

/**
 * FR-018. The listing parameters, one OpenAPI parameter per property of the live
 * query schema. `io: 'input'` matters: the other variant marks `limit` required,
 * because a default always produces a value on the way out, and would document a
 * required parameter that is in fact optional (research R2).
 */
export interface QueryParameterSchemas {
  limit: JsonSchemaObject;
  cursor: JsonSchemaObject;
  status: JsonSchemaObject;
}

export function buildListQueryParameterSchemas(): QueryParameterSchemas {
  const converted = stripJsonSchemaMembers(
    z.toJSONSchema(listOrdersSchema, { target: 'draft-2020-12', io: 'input' }) as JsonSchemaObject,
  );
  const properties = converted.properties as Record<string, JsonSchemaObject | undefined>;

  // Narrowed by throwing rather than by defaulting to an empty object. An empty
  // schema documents "anything goes", which is the opposite of what the query
  // string accepts, and it would ship silently.
  const required = (name: keyof QueryParameterSchemas): JsonSchemaObject => {
    const schema = properties[name];
    if (schema === undefined) {
      throw new Error(`The listing query schema no longer declares a "${name}" parameter.`);
    }
    return schema;
  };

  return { limit: required('limit'), cursor: required('cursor'), status: required('status') };
}

/** Repeated in prose on the listing operation, sourced from the same constants. */
export const PAGE_SIZE_DOCUMENTATION = {
  default: DEFAULT_PAGE_SIZE,
  maximum: MAX_PAGE_SIZE,
} as const;
