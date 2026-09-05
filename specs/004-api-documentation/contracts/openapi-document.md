# Contract: The Published API Document

**Feature**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

This is what the document must contain. It is not a second description of the API: the API's contract
is [Spec 003's](../../003-order-lifecycle/contracts/http-api.md) and Spec 001's, and this file says
only how those contracts must appear once published, and which of those statements are asserted by a
test rather than hoped for.

Everything here is checkable against the generated document without a browser.

## Document level

| Member | Requirement |
| :--- | :--- |
| `openapi` | `3.1.0`, set explicitly rather than left to the default |
| `info.title` | Names the system |
| `info.version` | The service version |
| `info.description` | States what the system is, that money is integer minor units, that ordering timestamps are integer microseconds, that a server error is representable while no caller-constructible input produces one, and that the API requires no credentials |
| `tags` | `Orders` and `Operations`, so the order surface reads as one thing and the health surface as another |
| `components.schemas` | Every component in the data model, each reachable by `$ref` |
| `components.securitySchemes` | **Absent.** FR-047 forbids declaring a scheme, and an empty one would still render a credential input |
| `security` | **Absent**, for the same reason |

The document description is where FR-038's server-error statement lives. There is no `500` on any
operation, and a test asserts that.

## Every operation

Each of the five operations must carry:

| Element | Requirement |
| :--- | :--- |
| `operationId` | Set explicitly. The framework's default is `ControllerName_method`, which publishes an internal class name and would change on a rename (R6) |
| `summary` | One line, in the caller's language rather than the implementation's |
| `description` | What it does and what it guarantees, including anything a caller would otherwise have to discover |
| `tags` | Exactly one |
| `responses` | Every status the operation can return **for a request a caller can construct**, each with a description of the condition that produces it |
| Failure bodies | `$ref` to `ErrorBody`, never an inline copy |

No operation may carry a `500`, a `requestBody` on an operation that takes none, or a parameter the
service does not read.

## Per-operation detail

### `POST /api/v1/orders`

| Element | Requirement |
| :--- | :--- |
| Request body | `$ref` to `CreateOrderRequest`, derived from the live validation schema, carrying `additionalProperties: false` |
| `Idempotency-Key` | Optional header parameter, with its length and character set, and the consequence of omitting it |
| `X-Correlation-Id` | Optional header parameter |
| 201 | The created order, with `Location` and `X-Correlation-Id` response headers documented |
| 200 | The replayed order, with `Idempotent-Replay` and `X-Correlation-Id` documented |
| 400 | `VALIDATION_FAILED`, `CUSTOMER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `ORDER_TOTAL_NOT_REPRESENTABLE`, `INVALID_IDEMPOTENCY_KEY` |
| 409 | `IDEMPOTENCY_KEY_REUSED` |

The 200 and 201 share a body and differ by header, so omitting the response headers would leave the
only distinguishing signal undocumented. That is why FR-044 exists.

### `GET /api/v1/orders/{id}`

| Element | Requirement |
| :--- | :--- |
| Path parameter | Integer, minimum 1 |
| 200 | `$ref` to `OrderView` |
| 400 | `VALIDATION_FAILED`, with the note that a non-numeric identifier is malformed rather than missing |
| 404 | `ORDER_NOT_FOUND` |

### `GET /api/v1/orders`

| Element | Requirement |
| :--- | :--- |
| `limit` | Derived from the live query schema: integer, 1 to 100, default 50, and documented as rejected rather than clamped when out of range |
| `cursor` | String, **opaque**. Its encoding is not described and no example is given that a reader could decode |
| `status` | Enumeration of the three statuses |
| Unknown parameters | Documented as rejected, including `offset` and `page` |
| 200 | `$ref` to `ListOrdersResponse`, with the continuation token described as absent on the final page |
| 400 | `VALIDATION_FAILED`, `INVALID_CURSOR` |

### `POST /api/v1/orders/{id}/cancel`

| Element | Requirement |
| :--- | :--- |
| Request body | None. Documented as taking none |
| 200 | The updated order |
| 400 | `VALIDATION_FAILED` |
| 404 | `ORDER_NOT_FOUND` |
| 409 | `TRANSITION_NOT_PERMITTED`, described as covering both a late caller and a transition that was never legal, because those are the same fact |

### `GET /health`

| Element | Requirement |
| :--- | :--- |
| Path | `/health`, outside the version prefix |
| 200 | `$ref` to `HealthReport`, all dependencies healthy |
| 503 | The same body with a failing dependency named |

The 503 is the one status outside the order API's closed set. It is admitted explicitly by FR-040
rather than by relaxing the rule that keeps undocumented statuses out.

## Schema conventions the document must not violate

These are the constitution's conventions, restated as properties of the published document because
publishing a contradiction is how a document teaches the mistake it was written to prevent.

| Convention | Rule | How checked |
| :--- | :--- | :--- |
| Money | Every field whose name ends `Minor` is `type: integer`. No `number`, no `string`, no decimal example | Document walk (R11) |
| Timestamps | Every field whose name ends `Us` is `type: integer`. No `format: date`, no `format: date-time`, anywhere in the document | Document walk (R11) |
| Cursor | `nextCursor` is `type: string` with no described encoding and no decodable example | Assertion on the component |
| Derived values | `totalMinor` and `lineTotalMinor` are marked read-only, so a reader does not expect to send them | Assertion on the component |
| Example arithmetic | Each line total equals unit price times quantity; each order total equals the sum of its line totals | Assertion on the examples |

## What the document must not contain

Stated so that absence is a decision rather than an omission, and so each has something to test.

- **No security scheme and no security requirement.** The API takes no credentials, and declaring an
  empty scheme would render a credential input implying a check that does not exist.
- **No `500` on any operation.** Described once at document level instead, so that every documented
  response is one a test can provoke.
- **No operation that updates or deletes an order.** A stored order is permanent under Constitution
  Principle IV, and cancellation is the lifecycle's answer to an unwanted one.
- **No customer or product operation.** Those tables are Spec 002 placeholders with no HTTP surface.
- **No offset or page parameter**, not even documented as unsupported, because the service rejects
  them rather than accepting and ignoring them.
- **No ISO-8601 or millisecond rendering of any timestamp**, which is the value a client would build a
  cursor from.
- **No server list pointing anywhere but the origin serving the document**, so the page cannot execute
  against an environment the reader did not choose.

## Assertions this contract commits to

Each maps to a requirement and is a test, not a review item.

| Assertion | Requirement |
| :--- | :--- |
| Documented operations equal routed operations, both directions | FR-076, SC-001 |
| Every declared failure code appears in the document | FR-080, SC-002 |
| Every documented failure is provoked and returns the documented status and code | FR-077, SC-003 |
| No monetary field is non-integer and no timestamp is a formatted date | FR-078, SC-004 |
| Documented bounds equal enforced bounds | FR-079, SC-006 |
| Health responds identically with documentation mounted and not | FR-081, SC-007 |
| All three documentation paths report not found when disabled, and the API is unaffected | FR-082, SC-010 |
| Served document equals committed export | FR-083, SC-009 |
| Every `$ref` resolves | FR-068, SC-008 |
| No operation carries a `500`; no security scheme exists | FR-038, FR-047 |
| The docs paths are unprefixed and the prefixed paths 404 | FR-060a |
| The seed still produces the identifiers the examples use | FR-053a |
