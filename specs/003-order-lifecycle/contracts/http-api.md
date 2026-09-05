# HTTP Contract: Order Lifecycle

**Feature**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

This is the interface the system exposes. Everything below is observable from outside the process,
and everything below is asserted by an integration test rather than described here and hoped for.

All order endpoints live under `/api/v1`. The health endpoint stays on `/health`, outside the version
prefix, unchanged from Spec 001, so probes never track the API version.

## Conventions

**Money** is always an integer count of minor units. No field carries a decimal, a float, or a
formatted string. The ceiling is 9,007,199,254,740,991, which Spec 002's constraints enforce per
column and which this feature enforces on the one value no column can bound, the derived total.

**Timestamps** are always integer microseconds since the Unix epoch, named with a `Us` suffix. There
is deliberately **no ISO-8601 rendering of an ordering timestamp anywhere in this API**. A formatted
or millisecond-precision field is what a client would reach for when building its own cursor, and
Principle V exists because that value is truncated. Removing the field removes the mistake.

**Correlation.** Every request carries a correlation identifier, taken from an `X-Correlation-Id`
request header when it is well formed and generated otherwise. It is returned on every response,
success and failure alike, and appears in every log record produced while serving that request.

**Errors** all share one body:

```json
{
  "code": "ORDER_NOT_FOUND",
  "message": "No order exists with identifier 42.",
  "correlationId": "0f6c8a5e-...",
  "details": []
}
```

`code` is stable and machine-readable. `message` is for a human. `details` carries per-field
validation problems when there are any, and is an empty array otherwise. No error body ever contains a
stack trace, a driver message, a SQL fragment, or a filesystem path.

The complete set of status codes this API returns is **200, 201, 400, 404, 409, 500**. No input a
caller can construct produces a 500.

## `POST /api/v1/orders`

Create an order.

**Headers**

| Header | Required | Meaning |
| :--- | :--- | :--- |
| `Idempotency-Key` | no | 8 to 255 characters of `[A-Za-z0-9_-]`. Absent means no replay protection, and each request creates an order |
| `X-Correlation-Id` | no | echoed back; generated when absent |

**Request**

```json
{
  "customerId": 1,
  "lines": [
    { "productId": 7, "quantity": 3 },
    { "productId": 9, "quantity": 1 }
  ]
}
```

That is the entire contract. `customerId` and `lines` are the only permitted top-level properties, and
`productId` and `quantity` the only permitted line properties. Anything else is rejected, not ignored.
In particular a caller cannot send `unitPriceMinor`, `lineTotalMinor`, `totalMinor`, `status`, `id`,
or any timestamp: prices are captured from the catalog, and the rest are the system's to decide.

| Rule | Bound |
| :--- | :--- |
| `lines` length | 1 to 100 |
| `quantity` | integer, 1 to 1,000,000 |
| `customerId`, `productId` | positive integers that resolve to existing rows |
| duplicate `productId` across lines | permitted; each line is priced and totalled independently |

**Responses**

| Status | When | Notes |
| :--- | :--- | :--- |
| 201 | created | body is the order representation; `Location` names the retrieval path |
| 200 | idempotent replay | the originally created order, with `Idempotent-Replay: true` |
| 400 | validation failed, or an unknown customer or product | nothing is written, not even the order row |
| 409 | the idempotency key was used before with a different request | nothing is written |

## `GET /api/v1/orders/{id}`

Retrieve one order.

| Status | When |
| :--- | :--- |
| 200 | found |
| 400 | `{id}` is not a positive integer |
| 404 | no order with that identifier |

A non-numeric identifier is a malformed request, not a missing resource, so it is 400 and not 404.

## `GET /api/v1/orders`

List orders, newest first.

| Parameter | Type | Default | Rules |
| :--- | :--- | :--- | :--- |
| `limit` | integer | 50 | 1 to 100. Out of range is rejected, never clamped |
| `cursor` | opaque string | none | from a previous response's `nextCursor`; malformed is rejected, never ignored |
| `status` | enum | none | one of `pending`, `processing`, `cancelled` |

`offset`, `page`, and any other unrecognised parameter are rejected. Pagination is keyset only, and
accepting an offset parameter while ignoring it would let a caller believe it was paging when it was
re-reading page one.

**Response**

```json
{
  "orders": [ { "id": 42, "...": "order representation" } ],
  "nextCursor": "eyJ0IjoxNzAw...",
  "limit": 50
}
```

`nextCursor` is `null` on the final page. Passing the same cursor twice with no intervening writes
returns the same page.

Changing `status` mid-traversal starts a new listing: the filter applies to the whole set and the
cursor only positions within it.

| Status | When |
| :--- | :--- |
| 200 | always, including an empty page |
| 400 | any parameter out of range, unrecognised, or malformed, including the cursor |

## `POST /api/v1/orders/{id}/cancel`

Cancel one order. Takes no request body.

| Status | When | Body |
| :--- | :--- | :--- |
| 200 | the order was `pending` and is now `cancelled` | the updated order |
| 400 | `{id}` is not a positive integer | error |
| 404 | no order with that identifier | error |
| 409 | the order is `processing` or already `cancelled` | error naming the current status and the attempted target |

There is no endpoint that sets an arbitrary status. Cancellation is the only transition a caller can
request, and promotion is the background job's alone.

A 409 here always means what it says: the order is not in a state from which cancellation is legal. It
is returned both when the caller was simply late and when the transition was never legal from that
state, because those are the same fact and distinguishing them would require the read-then-write guard
Principle II forbids.

## Order representation

Returned by every endpoint that returns an order.

```json
{
  "id": 42,
  "customerId": 1,
  "status": "pending",
  "createdAtUs": 1757030400123456,
  "updatedAtUs": 1757030400123456,
  "totalMinor": 4196,
  "lines": [
    {
      "id": 101,
      "productId": 7,
      "productDescription": "Widget",
      "unitPriceMinor": 1299,
      "quantity": 3,
      "lineTotalMinor": 3897
    }
  ]
}
```

| Field | Guarantee |
| :--- | :--- |
| `status` | always one of the three known values, enforced by a column constraint |
| `createdAtUs` | never changes, enforced by a trigger |
| `updatedAtUs` | advances on every change to the row, with no caller action, and is never earlier than `createdAtUs` |
| `totalMinor` | derived by summing `lineTotalMinor`, never stored. An order whose total is not exactly representable cannot exist, because creation aborts before storing one |
| `lines` | never empty, because an order and at least one line are written in one transaction |
| `lines[].lineTotalMinor` | equals `unitPriceMinor * quantity`, computed by the database rather than supplied |
| `lines[].unitPriceMinor` | the catalog price at the moment of placement, unaffected by later catalog changes |

Line items are returned in ascending `id`, which is stable across reads.

## What this contract does not offer

Stated so that absence reads as a decision rather than an oversight.

- **No update or delete of an order.** The only permitted change to a stored order is its status,
  through the two legal transitions. Constitution Principle IV makes a stored order permanent, and
  cancellation is the lifecycle's answer to an unwanted one.
- **No filter by customer.** Spec 002 left `orders.customer_id` deliberately unindexed under its
  FR-039a, so such a filter would scan the table behind an index-shaped API. Adding one requires
  adding the index first.
- **No offset pagination**, for the reason given above.
- **No customer or product endpoints.** Those tables are Spec 002 placeholders whose contract states
  only their `id` columns survive. A seeding command populates them; see
  [../quickstart.md](../quickstart.md).
- **No authentication.** The whole system is unauthenticated within the declared scope, so there is no
  identity to scope an idempotency key by, and no rule about who may cancel whose order.
