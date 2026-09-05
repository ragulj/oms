# Phase 0 Research: API Documentation and Swagger Playground

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every finding below was measured against the installed toolchain on this machine, not recalled. Four
of them changed the design, and two of those four reversed an assumption that looks obviously correct
until it is run.

## Verified environment

| Component | Version | How verified |
| :--- | :--- | :--- |
| Node.js | 24.19.0 | `process.versions.node` during the probe |
| TypeScript | 5.9.3 | `package.json` |
| NestJS core / common / platform-express | 12.0.1 | installed `package.json` |
| Express | 5.2.1 | dependency of `@nestjs/platform-express@12.0.1` |
| `@nestjs/swagger` | 12.0.1 | installed during Phase 0 to measure; peers on `@nestjs/core ^12.0.0` |
| `swagger-ui-dist` | 5.32.14 | transitive dependency of the above |
| zod | 4.5.4 | already present, validates configuration and requests |

`@nestjs/swagger` declares `class-validator` and `class-transformer` as peers, but
`peerDependenciesMeta` marks both **optional**. Neither is installed and neither is needed, which
matters because Spec 003 deliberately refused both.

## R1. zod schemas convert to OpenAPI schemas directly, bounds and all

**Question**: FR-008 and FR-010 forbid a second, hand-maintained description of a request body and
forbid restating a bound as a literal in the documentation layer. Is derivation actually available?

**Measured**: zod 4.5.4 exports `z.toJSONSchema`. Converting the live `createOrderSchema` emits:

```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
    "lines": {
      "type": "array", "minItems": 1, "maxItems": 100,
      "items": {
        "type": "object",
        "properties": {
          "productId": { "type": "integer", "exclusiveMinimum": 0, "maximum": 9007199254740991 },
          "quantity": { "type": "integer", "minimum": 1, "maximum": 1000000 }
        },
        "required": ["productId", "quantity"],
        "additionalProperties": false
      }
    }
  },
  "required": ["customerId", "lines"],
  "additionalProperties": false
}
```

**Decision**: derive every request schema this way.

**Why it matters more than it looks.** Three separate requirements are discharged by the conversion
itself rather than by anything written afterwards. `maxItems: 100` and `maximum: 1000000` are FR-016's
bounds, taken from the constants the service enforces rather than retyped. `additionalProperties:
false` is FR-015's statement that unknown properties are rejected, and it is present only because the
schema is a `strictObject`; had Spec 003 used a plain object, the document would have advertised
leniency that the service does not have, which is the same defect in a new place.

**Two limits found:**

- The output carries a `$schema` key that an OpenAPI schema object must not have. It is stripped.
- zod **inlines** a reused subschema rather than emitting a `$ref`. Converting
  `z.strictObject({ a: lineSchema, b: lineSchema })` produced the line schema twice, in full. FR-022
  requires the order representation to be described once and referenced. Reuse therefore requires
  `z.registry()` with explicit ids, whose conversion returns a `{ "schemas": { ... } }` map that drops
  straight into `components.schemas`.

**Alternatives rejected**: hand-written DTO classes carrying `@ApiProperty` decorators, which is the
conventional NestJS approach. Rejected because it creates exactly the second description FR-008
forbids: the class would declare `max: 1000000` next to a zod schema declaring the same bound, and
nothing would fail when they diverged.

## R2. Query parameters are derivable too, including coercion and defaults

**Question**: the listing endpoint validates its query string with `z.coerce` and `.default(50)`.
Coercion and defaults are the kind of thing a converter usually gives up on.

**Measured**, against the live `listOrdersSchema`:

```json
{
  "limit":  { "type": "integer", "minimum": 1, "maximum": 100, "default": 50 },
  "cursor": { "type": "string", "minLength": 1 },
  "status": { "type": "string", "enum": ["pending", "processing", "cancelled"] },
  "additionalProperties": false
}
```

The `io` option matters: `io: "input"` leaves `limit` optional, `io: "output"` marks it required
because a default always produces a value. **`io: "input"` is correct for a documented request**, and
choosing the other one would document a required parameter that is in fact optional.

**Decision**: derive the three query parameters from the same schema, one OpenAPI parameter per
property, using `io: "input"`.

## R3. The documentation paths escape the global prefix without being told to

**Question**: the clarification put the page at `/docs` and the document at `/docs-json`, outside
`/api/v1`. Spec 001 had to name `health` in an explicit `exclude` list to achieve that. Is a second
exclusion needed?

**Measured**, against the real application graph with the prefix applied exactly as `main.ts` applies
it:

| Request | Result |
| :--- | :--- |
| `GET /docs` | 200, `text/html` |
| `GET /docs-json` | 200, `application/json` |
| `GET /api/v1/docs` | 404 |
| `GET /api/v1/docs-json` | 404 |

Reading the installed `SwaggerModule.setup` source confirms why: it prepends the global prefix only
when `options.useGlobalPrefix` is set, and that option defaults to unset.

**Decision**: mount at `/docs` with `jsonDocumentUrl: 'docs-json'` and add nothing to the prefix
exclusion list. FR-060a's assertion is still required, because this is a default that a later option
change would silently reverse.

**A third path exists whether or not it is wanted.** `setup` unconditionally registers a YAML route
alongside the JSON one, so `/docs-yaml` responds 200 as well. It cannot be switched off, only renamed.
FR-060 names two paths; there are three. The plan records `/docs-yaml` as a documented consequence
rather than pretending it does not exist, and FR-059's disable behaviour and FR-060a's prefix
assertion both have to cover it.

## R4. Mounting documentation leaves the health endpoint untouched

**Question**: FR-081 exists because Spec 003 changed the health response body by scoping an exception
filter too widely, and only a Spec 001 test caught it. Adding routes, static assets and a catch-all is
the same class of change.

**Measured**: `GET /health` was captured from the real application graph twice, once without
documentation mounted and once with it.

| | Without docs | With docs |
| :--- | :--- | :--- |
| Status | 200 | 200 |
| Body | `{"status":"healthy","dependencies":{"database":"healthy"}}` | identical |
| `x-correlation-id` | present | present |

**Decision**: no mitigation needed, but FR-081 keeps its test. The measurement says the risk did not
materialise; it does not say it cannot.

## R5. Document generation is deterministic, so the committed export can be byte-compared

**Question**: FR-066 wants the verification command to fail on a drifted export, and FR-083 wants the
served document and the committed one to agree. Both are only meaningful if generation is stable.
Object key ordering is a common source of spurious diffs.

**Measured**: `SwaggerModule.createDocument` called twice against the same application produced
byte-identical JSON.

**Decision**: compare serialised JSON directly rather than deep-comparing parsed objects. A textual
comparison also makes the failure readable as a diff, which is what FR-065 is for.

## R6. Without decorators the generated document is close to empty

**Question**: how much does the framework infer on its own?

**Measured**, generating against the untouched Spec 003 controller:

```json
"post": {
  "operationId": "OrdersController_create",
  "parameters": [],
  "responses": { "201": { "description": "" } },
  "tags": ["Orders"]
}
```

`components.schemas` was `{}`. No request body, no response schema, no descriptions, no failure
codes, no headers.

**Two consequences.** First, essentially all of the specification's content requirements have to be
supplied deliberately; nothing arrives for free. Second, the default `operationId` is
`OrdersController_create`, which publishes an internal class name as part of a public contract and
would change if the class were ever renamed. Explicit operation identifiers are therefore part of the
work, not a nicety.

## R7. The library's "global response" feature does the opposite of what the clarification chose

**Question**: `DocumentBuilder.addGlobalResponse` looks like the direct implementation of FR-038,
which requires the server-error response to be described once at document level and **not** listed on
individual operations.

**Measured**: after `.addGlobalResponse({ status: 500, description: 'Server error' })`, the generated
`POST /api/v1/orders` operation contained:

```json
"responses": { "201": { "description": "" }, "500": { "description": "Server error" } }
```

The name means "add this response to every operation", not "add this response once globally". Using
it would put a `500` on every operation, which is precisely what FR-038 forbids and what would force
SC-003 to carry an exemption.

**Decision**: do not use `addGlobalResponse`. The server-error possibility is stated in the document
description and the error body is published as a shared component, while no operation lists a 500. A
test asserts the absence, because the natural-looking builder call would reintroduce it silently.

This is the finding most likely to be reversed by a future contributor who reads the method name and
not this note, which is why it also earns a line in the repository decision log.

## R8. Raw schema objects work on the decorators; no DTO class is required

**Question**: the derivation in R1 produces plain objects. The decorators are usually shown carrying
classes.

**Measured**: `@ApiBody({ schema: <derived object> })` produced a complete `requestBody` with every
bound intact. `@ApiResponse({ schema: { $ref: '#/components/schemas/X' } })` produced the reference,
and assigning `document.components.schemas` after `createDocument` resolved it.

**Decision**: derived objects on the decorators, shared components injected into the document after
creation from a zod registry. `@ApiExtraModels` and the class-based helpers are not used.

## R9. Express 5 moved the router, and the route table needs filtering

**Question**: FR-076 asserts the document's operation set against the routes the service actually
serves. That requires reading the router.

**Measured**: Express 5.2.1 exposes `app.router`; the Express 4 `app._router` is gone. Walking it
against the real application produced exactly:

```text
GET  /health
POST /api/v1/orders
GET  /api/v1/orders
GET  /api/v1/orders/:id
POST /api/v1/orders/:id/cancel
_ALL *path
```

With documentation mounted, seven further entries appear: `/docs`, `/docs/`, `/docs/index.html`,
`/docs/LICENSE`, `/docs/swagger-ui-init.js`, `/docs/docs/swagger-ui-init.js`, `/docs-json` and
`/docs-yaml`.

**Decision**: the coverage assertion compares against the router with two exclusions, the catch-all
`_ALL *path` (which is the framework's not-found handler, not an operation) and the documentation's
own routes. Both exclusions are named and justified in the test, because an over-broad filter would
let a genuinely undocumented route slip through, which is the one thing this assertion exists to
prevent. Express path syntax (`:id`) is converted to OpenAPI syntax (`{id}`) for comparison.

## R10. Responses cannot be derived from the implementation, so they are derived from a schema that also validates it

**Question**: FR-009 requires documented response schemas to be derived from, or verified against,
what the service produces. Requests are validated by zod and therefore have a runtime description.
Responses are TypeScript interfaces (`OrderView`, `LineView`, `ListOrdersResult`, `ErrorBody`), which
are erased at compile time and have no runtime description at all.

**Measured**: expressing `OrderView` as a zod schema gives both halves at once. The schema converts
to the documented component, and the same schema validates a real response:

| Input | `safeParse` |
| :--- | :--- |
| A well-formed order view | success |
| The same object plus a `createdAt` ISO string | **failure** |

**Decision**: response shapes are declared once as strict zod schemas that exist for documentation and
verification, and a dedicated conformance suite drives every response-producing operation and parses
each real response through the matching schema. This is FR-012's "asserted by a test that fails when
they diverge", made concrete: adding a field to a response without documenting it fails, and
documenting a field the response does not carry fails too.

**Not** by retrofitting the parse into Spec 003's existing suites. FR-075 requires those to pass
unmodified and treats any need to edit them as evidence of an unintended behaviour change, so this
feature adds coverage beside them rather than inside them.

**Alternative rejected**: hand-writing the response components and eyeballing them against the
controller. That is the drift this whole specification exists to prevent.

**Cost admitted**: the response schemas are a second description of a shape TypeScript already
describes, which is uncomfortably close to what FR-008 forbids for requests. The difference is that
this second description is *executable against the real response*, so the two cannot silently
disagree. A type and a schema that must agree, with a test that fails when they do not, is a different
thing from two documents that merely ought to match.

## R11. The money and timestamp leak check is mechanical

**Question**: FR-078 and SC-004 require that no monetary field is documented as a non-integer and no
timestamp as a formatted date. That has to be checkable without a human reading the page.

**Measured**: walking the generated document and flagging any node whose path ends in `Minor` or `Us`
with a `type` other than `integer`, plus any node carrying `format: date` or `format: date-time`,
reported zero offenders against a correct document. The check is a dozen lines and needs no
dependency.

**Decision**: implement exactly that walk as a test. The naming convention Spec 003 chose, a `Minor`
suffix on money and a `Us` suffix on timestamps, is what makes the check possible; it was adopted for
readability and turns out to be machine-checkable, which is worth recording.

## R12. Validity checking without another dependency

**Question**: SC-008 requires the export to be a valid document that loads with zero unresolved
references. A schema validator would be another dependency.

**Decision**: assert structurally instead. Walk every `$ref` in the document and confirm each target
exists in `components`, assert the required top-level members are present, and confirm the declared
OpenAPI version. Rendering in a real viewer stays a manual quickstart step, because a test asserting
against rendered markup would be testing the viewer.

## R13. The obvious way to read the on/off setting is wrong

**Question**: FR-057 adds one configuration setting deciding whether documentation is served.
Environment variables are strings, and the existing config schema reaches for `z.coerce` for its
numeric settings, so `z.coerce.boolean()` is the shape a reader would expect next.

**Measured**:

| Expression | Result |
| :--- | :--- |
| `z.coerce.boolean().parse('false')` | **`true`** |
| `z.stringbool().parse('false')` | `false` |
| `z.stringbool().parse('0')` | `false` |
| `z.stringbool().default(true).parse(undefined)` | `true` |

`z.coerce.boolean()` applies JavaScript truthiness, and every non-empty string is truthy. A developer
who set `DOCS_ENABLED=false` would get documentation served, with no error and nothing in the logs to
explain it.

**Decision**: use `z.stringbool()`. A test asserts that the string `false` disables documentation,
because this is a defect that reports success.

## Risks

| Risk | Severity | Handling |
| :--- | :--- | :--- |
| A contributor uses `addGlobalResponse` because the name matches the intent | Medium | R7's test asserts no operation lists a 500; decision log records the trap |
| The YAML route is forgotten and stays reachable when documentation is disabled | Medium | FR-059's test enumerates all three documentation paths, not two |
| `useGlobalPrefix` is later switched on, moving the docs under `/api/v1` | Low | FR-060a asserts both the served path and the 404 at the prefixed path |
| A response gains a field that the response schema does not describe | Medium | R10's parse-every-response rule turns it into a test failure |
| The committed export drifts from the implementation | Medium | R5's determinism makes a byte comparison viable; FR-066 puts it in the verification command |
| The verification command gets slower because it now builds the document | Low | Accepted in the clarification; the build is an in-process document generation, not a server start |
| Prefilled examples stop resolving because the seed changes | Medium | FR-053a asserts the seed still produces the documented identifiers |
