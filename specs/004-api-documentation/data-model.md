# Data Model: API Documentation and Swagger Playground

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

**This feature persists nothing.** It adds no table, no column, no index, no constraint, no trigger
and no migration, so `drizzle-kit generate` must continue to report no pending change after it lands.
The three-phase test isolation ordering Spec 003 established is untouched, because there is no new
table to place in it.

What follows is therefore a model of artifacts and configuration rather than of storage.

## Existing entities, and how they are used

| Entity | Owned by | Use here |
| :--- | :--- | :--- |
| Order | Spec 002 | Its response representation is described as a shared component. Nothing about the table is documented, only what the API returns |
| Order Line Item | Spec 002 | Described as a nested component of the order representation |
| Customer, Product | Spec 002 | Referenced only as identifiers inside request and response schemas. No operation over them is documented, because none exists |
| Idempotency Record | Spec 003 | Never described. It is an internal mechanism, and its observable surface is the request header and the replay status code, which are documented instead |

## Documentation components

Each is declared once, registered with the identifier below, and referenced by `$ref` everywhere it
appears. R1 established that reuse requires an explicit registry, because the converter otherwise
inlines a repeated shape.

| Component id | Derived from | Appears in |
| :--- | :--- | :--- |
| `CreateOrderRequest` | the live `createOrderSchema` | request body of create |
| `OrderView` | a response schema that also validates real responses | 201 and 200 of create, 200 of retrieve, 200 of cancel, and inside the listing envelope |
| `OrderLineView` | nested in the above | `OrderView.lines` |
| `ListOrdersResponse` | a response schema over the listing envelope | 200 of list |
| `ErrorBody` | a response schema over the error envelope | every documented failure, and the document-level server-error note |
| `ErrorDetail` | nested in the above | `ErrorBody.details` |
| `HealthReport` | a response schema over the health report | 200 and 503 of health |
| `OrderStatus` | the existing status tuple | `OrderView.status`, and the `status` query parameter |

`ErrorCode` is documented as an enumeration inside `ErrorBody`, populated from the service's declared
code list rather than retyped, so FR-011 and FR-080 hold by construction.

## Route inventory

The complete set the document must match, measured from the router in R9. Express path syntax is
converted to OpenAPI syntax for the coverage comparison.

| Method | Router path | Documented path | Tag |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/orders` | `/api/v1/orders` | Orders |
| GET | `/api/v1/orders` | `/api/v1/orders` | Orders |
| GET | `/api/v1/orders/:id` | `/api/v1/orders/{id}` | Orders |
| POST | `/api/v1/orders/:id/cancel` | `/api/v1/orders/{id}/cancel` | Orders |
| GET | `/health` | `/health` | Operations |

Two router entries are excluded from the comparison, each for a stated reason:

| Excluded | Reason |
| :--- | :--- |
| `_ALL *path` | The framework's not-found handler. It is not an operation and has no contract |
| The documentation's own routes | They describe the API rather than forming part of it. Enumerated explicitly rather than matched by prefix, so a future API route beginning `doc` cannot be swallowed by the filter |

## Documentation routes

Three, not two. R3 established that the YAML route is registered unconditionally and can be renamed
but not suppressed.

| Path | Content | Committed to by |
| :--- | :--- | :--- |
| `/docs` | The interactive page, plus its static assets under the same prefix | FR-049, FR-060 |
| `/docs-json` | The machine-readable document | FR-060, FR-067 |
| `/docs-yaml` | The same document in YAML | Not named by FR-060, recorded here because it exists |

All three sit outside the `/api/v1` prefix by default rather than by exclusion, and all three must
report not found when documentation is disabled.

## Configuration

One addition to the settings the service recognises.

| Setting | Type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `DOCS_ENABLED` | boolean from string | `true` | Read with `z.stringbool`, never `z.coerce.boolean`. R13 measured that the latter parses the string `false` as `true`, so the obvious spelling would silently ignore the operator |

The default is on. The system is unauthenticated within its declared scope, so gating the page would
protect nothing while removing a reviewer's first useful surface. The setting exists so a deployment
outside that scope can turn it off without a code change.

`.env.example` gains the setting with its default, per the rule Spec 001 set that the file lists
every setting the service recognises.

## Prefilled example values

FR-053a makes these a contract rather than decoration.

| Example field | Source | Guarantee |
| :--- | :--- | :--- |
| `customerId` | the seeding command's first customer | The seed produces it on every run; a test asserts it |
| `lines[].productId` | the seeding command's products | As above |
| `quantity` | a fixed small integer | Within the documented bounds |

Response examples are illustrative and internally consistent: each line total equals its unit price
times its quantity, and each order total equals the sum of its line totals, per FR-030. They are not
asserted to correspond to any stored row, because a response example is not something a caller sends.

## Artifacts

| Artifact | Location | Produced by | Checked by |
| :--- | :--- | :--- | :--- |
| Committed export | `openapi.json` at the repository root | the export script | the verification command, which fails on any difference (FR-066) |
| Served document | `/docs-json` | the running service | a test asserting it matches the committed export (FR-083) |

The export script builds the application graph and generates the document without listening on a
port, which is what FR-064 means by obtainable without starting the service. It runs in two modes,
writing the file and checking it, so the generator and the gate cannot disagree about what the
document should be.
