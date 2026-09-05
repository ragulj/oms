# Feature Specification: API Documentation and Swagger Playground

**Feature Branch**: `004-api-documentation`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Create Spec 004: API Documentation and Swagger Playground. Define the integration and configuration of Swagger/OpenAPI documentation for the application's HTTP APIs. Scope: Swagger/OpenAPI integration with NestJS, API documentation generation, documentation of the existing Order APIs, request and response schemas, validation/error response documentation, authentication configuration if applicable to the existing API, Swagger UI playground configuration for interactively testing the APIs, developer-friendly local access and configuration. The documentation must accurately reflect the implemented API contracts and should not introduce new business behavior. Do not change the Order domain model or business workflows. Do not add new API functionality solely for Swagger. Follow the constitution and standard Spec Kit structure. Focus on functional requirements, technical constraints, and success criteria. Keep implementation details for the planning phase."

This specification adds a description of an interface that already exists. It introduces no endpoint,
no field, no status code, and no stored data. Every statement it makes about the API is a statement
Spec 003 already made in [contracts/http-api.md](../003-order-lifecycle/contracts/http-api.md), and
every statement it makes about the health endpoint is one Spec 001 already made.

That is the whole difficulty. A description maintained separately from the thing it describes is a
description that drifts, and a confidently wrong description is worse than none, because a caller
who reads no documentation writes a probe and a caller who reads wrong documentation writes a bug.
Most of what follows exists to make drift detectable rather than to make the page look complete.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand the API Without Reading the Source (Priority: P1)

Someone who has never seen this system opens one page in a browser and learns the complete HTTP
surface: which operations exist, what each one accepts, what each one returns, which failures each
one can produce, and what each failure means. They learn it without opening a source file, without
running a request, and without being told anything the running service would not actually do.

**Why this priority**: This is the feature. Everything else is either a way of using this description
interactively or a way of keeping it honest. An accurate published contract is the minimum
deliverable and is independently valuable even if nothing is ever executed from the page.

**Independent Test**: Start the service, open the documentation page, and confirm that every
operation the service routes appears there with its request shape, its response shape, and its
failure modes, and that nothing appears there which the service does not route.

**Acceptance Scenarios**:

1. **Given** the running service, **When** the documentation page is opened, **Then** all four order
   operations and the health endpoint are listed, and no operation is listed that the service does
   not serve.
2. **Given** the documentation page, **When** the order creation operation is inspected, **Then** the
   request body shows exactly `customerId` and `lines`, with `productId` and `quantity` inside each
   line, and shows no price, total, status, identifier, or timestamp field.
3. **Given** the documentation page, **When** any operation is inspected, **Then** every status code
   it can return is listed with the condition that produces it, and no status code is listed that the
   operation cannot return.
4. **Given** the documentation page, **When** a failure response is inspected, **Then** the shared
   error body is shown with the machine-readable codes that operation can emit.
5. **Given** the documentation page, **When** the security section is inspected, **Then** it states
   positively that the API requires no credentials, rather than being silent on the question.

---

### User Story 2 - Try the API From the Browser (Priority: P2)

A reviewer with the service running places an order, reads it back, lists orders, and cancels one,
entirely from the documentation page, using nothing but a browser. They see the real status codes,
the real response bodies, and the real response headers that the service produced.

**Why this priority**: Reading a contract and trusting a contract are different acts. An executable
page converts the document from a claim into a demonstration, and it removes the setup step that
otherwise stands between a reviewer and their first successful request.

**Independent Test**: With the service running and the catalog seeded, complete a create, read, list
and cancel cycle from the browser alone, and confirm each response matches what the document
promised for that outcome.

**Acceptance Scenarios**:

1. **Given** a seeded catalog and the documentation page open, **When** the create operation is
   executed with a valid body, **Then** the page shows a 201, the stored order, and the `Location`
   response header naming the retrieval path.
2. **Given** an order created from the page, **When** the retrieve operation is executed with that
   identifier, **Then** the page shows a 200 and the same order.
3. **Given** an order created from the page, **When** the cancel operation is executed twice against
   it, **Then** the first execution shows a 200 and the second shows a 409 carrying
   `TRANSITION_NOT_PERMITTED`.
4. **Given** the create operation, **When** it is executed with a quantity of zero, **Then** the page
   shows a 400 whose body names the offending field, exactly as a request from any other client would
   receive.
5. **Given** any operation executed from the page, **When** its response is inspected, **Then** it
   carries a correlation identifier, so an execution from the page can be traced in the logs like any
   other request.

---

### User Story 3 - Documentation That Cannot Silently Drift (Priority: P3)

A developer changes a validation bound, adds a field, or introduces a failure code. The published
document changes with it, or the build fails. It is not possible to ship a change that makes the
document wrong while every check stays green.

**Why this priority**: A description that is accurate on the day it is written and unverified
thereafter is a liability with a delay fuse. This story is what makes the first two stories still
true in six months, but it depends on both, so it is delivered after them.

**Independent Test**: Change a single validation bound in the implementation, regenerate, and confirm
the published document changes to match without anyone editing it by hand. Then hand-edit the
published document out of agreement with the implementation and confirm a check fails.

**Acceptance Scenarios**:

1. **Given** the documented maximum page size, **When** the implementation's page-size bound is
   changed, **Then** the published document reports the new bound with no separate edit.
2. **Given** the documented request body for order creation, **When** a field is added to the
   implementation's request schema, **Then** the published document shows the new field.
3. **Given** the set of failure codes the service can emit, **When** a code is added, **Then** a check
   fails until the document accounts for it.
4. **Given** an exported document committed to the repository, **When** it no longer matches what the
   service would publish, **Then** a check reports the difference and fails.
5. **Given** the documented operations, **When** an operation is added to or removed from the service,
   **Then** a check fails until the document matches the routes the service actually serves.

---

### User Story 4 - Take the Contract Somewhere Else (Priority: P4)

A consumer takes the machine-readable contract out of this repository and uses it elsewhere: to
generate a client, to load into a request tool, to diff against a previous release, or to review in a
pull request without starting the service.

**Why this priority**: Real, but the smallest increment of the four, and useful only once the document
is both complete and trustworthy. It is also what makes drift reviewable in a diff rather than only
detectable by a failing check.

**Independent Test**: Retrieve the machine-readable document without starting the service, load it
into an independent viewer, and confirm it is valid and self-contained.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the exported document is opened, **Then** it is a valid
   OpenAPI document that describes the full surface with no external references to resolve.
2. **Given** the running service, **When** the machine-readable document is requested over HTTP,
   **Then** it is byte-identical in content to the committed export.
3. **Given** a change to the API, **When** the export is regenerated, **Then** the difference is
   visible as a reviewable diff rather than only as a failing check.

---

### Edge Cases

- **The health endpoint is not under the version prefix.** Every order operation lives under
  `/api/v1` and the health endpoint deliberately does not. A document that lists health at
  `/api/v1/health` would be wrong in a way that costs a reader a real debugging session, and the
  playground would exercise a path that returns 404.
- **The health endpoint returns a status code the order API never returns.** The order API's status
  codes are a closed set of 200, 201, 400, 404, 409 and 500. Health additionally returns 503 when a
  dependency is unhealthy. A rule that forbids undocumented status codes has to admit this one
  without weakening into a rule that admits anything.
- **Mounting documentation must not change any existing response.** Spec 003 changed the health
  response body by scoping an exception filter too widely, and only a Spec 001 test caught it. Adding
  a page, a document route, and static assets is the same class of change.
- **Path collision.** The documentation paths must not shadow an API route, be captured by the global
  version prefix, or be intercepted by the order module's error handling.
- **Money rendered as a decimal.** Every monetary field is an integer count of minor units. An example
  showing `41.96` or `"41.96"` teaches a reader precisely the mistake Constitution Principle IV
  exists to prevent, and would be believed because it appears in the official description.
- **A timestamp rendered as a formatted string.** Ordering timestamps are integer microseconds. There
  is deliberately no ISO-8601 rendering anywhere in this API, because that is the value a client
  reaches for when building its own cursor. A document that invents one reintroduces the truncation
  Principle V exists to prevent.
- **A cursor documented as if it had structure.** `nextCursor` is opaque. Documenting its encoding, or
  showing an example a reader can decode, invites clients to construct their own, which makes the
  cursor format a public contract by accident.
- **Executing creation twice from the page.** Without an idempotency key, two executions create two
  orders. That is correct behaviour, and the page has to make it visible rather than surprising.
- **The document is requested when the playground is switched off.** Both the page and the
  machine-readable route have to behave consistently, and the service has to start and serve the API
  normally.
- **An operation that returns a body only on some outcomes.** Creation returns the order on both 201
  and 200, but the 200 additionally carries a replay marker header. A document that omits response
  headers hides the only signal that distinguishes the two.
- **Absent operations.** There is no update and no delete for an order. A generated document that
  invents them, or a page that leaves a reader unsure whether they exist, is wrong by omission.
- **A large listing response in the browser.** A page of 100 orders each with 100 lines is a large
  document to render. The page must remain usable, and the service must not behave differently
  because the caller was a browser.

## Requirements *(mandatory)*

### Functional Requirements

#### Coverage: what must be described

- **FR-001**: The system MUST publish a machine-readable API document describing every HTTP operation
  the service exposes.
- **FR-002**: The document MUST cover all four order operations: create an order, retrieve an order by
  identifier, list orders, and cancel an order.
- **FR-003**: The document MUST cover the health endpoint at its actual unversioned path, distinct
  from the versioned path every order operation uses.
- **FR-004**: The document MUST NOT describe any operation the service does not route, and MUST NOT
  omit any operation the service does route.
- **FR-005**: The document MUST NOT describe an operation that updates or deletes a stored order, and
  MUST record the absence of such operations as deliberate rather than leaving it unexplained.
- **FR-006**: The document MUST group operations so a reader can see the order surface as one thing
  and the operational surface as another.
- **FR-007**: The document MUST carry a title, a version, and a short description that states what the
  system is and what its scope excludes.

#### Accuracy: the document must be derived, not authored

- **FR-008**: Documented request schemas MUST be derived from the same definitions that validate
  incoming requests at runtime. A second, independently maintained description of a request body MUST
  NOT exist.
- **FR-009**: Documented response schemas MUST be derived from, or verified against, the responses the
  service actually produces.
- **FR-010**: Documented validation bounds MUST be derived from the values the service enforces. A
  bound MUST NOT be restated as a literal in the documentation layer.
- **FR-011**: The set of documented failure codes MUST be derived from the service's declared set of
  failure codes, so a new code cannot be introduced without appearing.
- **FR-012**: Where a documented element cannot be derived, its agreement with the implementation MUST
  be asserted by a test that fails when they diverge.
- **FR-013**: The document MUST be regenerated from the implementation rather than edited by hand, and
  a hand edit MUST be detectable.

#### Request documentation

- **FR-014**: The order creation request MUST be documented as accepting exactly `customerId` and
  `lines`, and each line as accepting exactly `productId` and `quantity`.
- **FR-015**: The document MUST state that unknown properties are rejected rather than ignored, on
  every request body and query string that rejects them.
- **FR-016**: The document MUST state the numeric bounds the service enforces: the permitted range for
  a line quantity, the permitted number of lines in an order, and the permitted range and default for
  a page size.
- **FR-017**: The document MUST state that identifiers supplied in a request must resolve to existing
  rows, and MUST name the failure produced when they do not.
- **FR-018**: The document MUST describe the listing parameters, their defaults, and the fact that an
  out-of-range page size is rejected rather than clamped.
- **FR-019**: The document MUST record that offset-style paging parameters are rejected rather than
  ignored.
- **FR-020**: The path parameter on the retrieve and cancel operations MUST be documented as a
  positive integer, and the document MUST record that a non-numeric value is a malformed request
  rather than a missing resource.
- **FR-021**: The document MUST record that the cancel operation takes no request body.

#### Response documentation

- **FR-022**: The order representation MUST be documented once and referenced by every operation that
  returns one, rather than repeated per operation.
- **FR-023**: Every monetary field MUST be documented as an integer count of the currency's minor
  unit, and MUST NOT be typed, formatted, or exemplified as a decimal, a floating point value, or a
  formatted string.
- **FR-024**: Every timestamp field MUST be documented as an integer count of microseconds since the
  Unix epoch, and MUST NOT be typed, formatted, or exemplified as a date, a date-time string, or a
  millisecond value.
- **FR-025**: The document MUST record which returned values are derived rather than stored, so a
  reader does not expect to be able to write them.
- **FR-026**: The listing response MUST be documented with its page of orders, its continuation token,
  and the page size that was applied.
- **FR-027**: The continuation token MUST be documented as opaque. Its encoding MUST NOT be described,
  and no example may be given that a reader could decode into a usable structure.
- **FR-028**: The document MUST record that the continuation token is absent on the final page, and
  what a caller should conclude from that.
- **FR-029**: The document MUST record that line items are returned in a stable order.
- **FR-030**: Every documented example MUST be internally consistent, so that a line total equals its
  unit price times its quantity and an order total equals the sum of its line totals.

#### Failure documentation

- **FR-031**: The single error body MUST be documented once and referenced by every failure response.
- **FR-032**: Every operation MUST document each status code it can return together with the
  condition that produces it.
- **FR-033**: No operation MUST document a status code outside the set the service can return for it.
- **FR-034**: The document MUST record the complete set of machine-readable failure codes, and each
  operation MUST name the subset it can emit.
- **FR-035**: The document MUST record that the failure code is the stable, machine-readable part of
  an error and the message is not, so a caller branches on the former.
- **FR-036**: Validation failures MUST be documented as carrying per-field detail, and successful and
  non-validation failures as carrying an empty detail list.
- **FR-037**: The document MUST record that no error body contains a stack trace, a driver message, a
  query fragment, or a filesystem path.
- **FR-038**: The document MUST record that for the order API no input a caller can construct produces
  a server error, while still documenting that a server error is representable.
- **FR-039**: The conflict produced by cancelling an order that is not cancellable MUST be documented
  as covering both a late caller and a transition that was never legal, since those are the same fact.
- **FR-040**: The health endpoint's unhealthy status code MUST be documented, and MUST be permitted by
  the status-code rules despite falling outside the order API's closed set.

#### Header documentation

- **FR-041**: The optional idempotency request header MUST be documented on the creation operation,
  with its permitted length and character set, and with the consequence of omitting it.
- **FR-042**: The optional correlation request header MUST be documented, together with the fact that
  a well-formed value is echoed and an absent or malformed one is replaced by a generated value.
- **FR-043**: The correlation response header MUST be documented on every operation, on both success
  and failure.
- **FR-044**: The creation operation MUST document its location response header on creation, and its
  replay marker response header on a replayed request.
- **FR-045**: The document MUST record that a replayed creation returns a different status code from
  an original creation while returning the same body, so a caller can distinguish them without
  comparing bodies.

#### Authentication

- **FR-046**: The document MUST state positively that the API requires no authentication and no
  authorisation, rather than omitting the subject.
- **FR-047**: The document MUST NOT declare a credential scheme, and MUST NOT present a credential
  input in the interactive page, since presenting one would imply a check that does not exist.
- **FR-048**: The document MUST record that the absence of authentication is a declared scope
  boundary of this system rather than an oversight, and MUST NOT imply that a future scheme is
  configured.

#### Interactive playground

- **FR-049**: The system MUST serve an interactive documentation page from which each documented
  operation can be executed against the running service.
- **FR-050**: An execution from the page MUST reach the same code path as any other client's request,
  and MUST NOT be given a relaxed validation, an alternative route, or a modified response.
- **FR-051**: The page MUST show the response status code, the response body, and the response headers
  that the service returned.
- **FR-052**: The page MUST allow a value to be supplied for every documented request header and query
  parameter, including the idempotency and correlation headers.
- **FR-053**: The page MUST offer a prefilled example request for each operation that is valid against
  a freshly seeded catalog, so a reviewer's first execution succeeds without them composing a body.
- **FR-054**: The page MUST make clear that repeating a creation without an idempotency key creates a
  second order.
- **FR-055**: The page MUST be served from the same origin as the API, so no cross-origin
  configuration is required and none is introduced.
- **FR-056**: Executing an operation from the page MUST NOT require any credential, header, or token
  that a non-browser client would not require.

#### Configuration and local access

- **FR-057**: Whether the documentation page and machine-readable document are served MUST be
  controlled by a single documented configuration setting.
- **FR-058**: The setting MUST default to serving them, and the default MUST be recorded alongside
  every other setting the service recognises.
- **FR-059**: When the setting disables documentation, both the page and the machine-readable route
  MUST report that they do not exist, and the service MUST start and serve the API unchanged.
- **FR-060**: The path at which the documentation is served MUST be documented and MUST NOT collide
  with, shadow, or be shadowed by any API route.
- **FR-061**: The service MUST record the documentation address in its startup output when
  documentation is enabled, so a developer does not have to guess or search for it.
- **FR-062**: The repository's own developer documentation MUST state how to reach the page, in the
  same place it states how to start the service.
- **FR-063**: Reaching a working page from a clean checkout MUST require no step that is not already
  documented for running the service, beyond seeding the catalog.

#### Export artifact

- **FR-064**: The machine-readable document MUST be obtainable without starting the service.
- **FR-065**: The exported document MUST be committed to the repository so that a change to the API
  surface appears as a reviewable difference.
- **FR-066**: A check MUST fail when the committed export differs from what the implementation would
  produce, in the same way the project's existing schema check fails on an uncommitted schema change.
- **FR-067**: The document served over HTTP and the committed export MUST describe the same surface.
- **FR-068**: The exported document MUST be self-contained, resolving no external references.

#### Non-interference

- **FR-069**: Introducing documentation MUST NOT change the status code, body, or headers of any
  existing endpoint.
- **FR-070**: Introducing documentation MUST NOT alter validation, error handling, correlation
  identifiers, or logging for any existing request.
- **FR-071**: Introducing documentation MUST NOT add, remove, or rename an endpoint, a field, a status
  code, or a failure code.
- **FR-072**: Introducing documentation MUST NOT alter the order data model, any stored value, or any
  business workflow, and MUST NOT require a schema change or a migration.
- **FR-073**: Introducing documentation MUST NOT introduce a second persistence path, and the
  documentation layer MUST NOT read or write the database.
- **FR-074**: Introducing documentation MUST NOT change the background processing behaviour, its
  cadence, or its bounds.
- **FR-075**: The existing test suites MUST continue to pass unchanged, and any that require
  modification MUST be treated as evidence of an unintended behaviour change rather than as tests
  needing adjustment.

#### Verification

- **FR-076**: The document's operation set MUST be asserted against the routes the service actually
  serves, so an undocumented or over-documented operation fails a test.
- **FR-077**: For each documented failure, a test MUST provoke that failure against the running
  service and assert that the observed status code and failure code are the documented ones.
- **FR-078**: A test MUST assert that no documented monetary field is typed or exemplified as a
  non-integer, and that no documented timestamp field is typed or exemplified as a formatted date.
- **FR-079**: A test MUST assert that the documented validation bounds equal the bounds the service
  enforces.
- **FR-080**: A test MUST assert that every declared failure code appears in the document.
- **FR-081**: A test MUST assert that mounting documentation leaves the health endpoint's response
  unchanged, since that is the specific regression this project has already had once.
- **FR-082**: A test MUST assert that the documentation paths return a not-found result when
  documentation is disabled, and that the API is unaffected in that configuration.
- **FR-083**: A test MUST assert that the served document and the committed export agree.
- **FR-084**: Tests for this feature MUST run against a real running application rather than a mocked
  or partially constructed one, since the property under test is what the assembled service actually
  publishes.
- **FR-085**: Tests for this feature MUST leave no state behind and MUST produce the same result run
  alone as in the full suite, under the project's existing isolation rules.
- **FR-086**: Removing any single documentation guarantee MUST turn the suite red, measured by
  mutating each guarantee in turn.

### Key Entities *(include if feature involves data)*

None of these are persisted. This feature adds no table, no column, and no migration.

- **API Document**: The complete machine-readable description of the HTTP surface. Derived from the
  running application rather than authored, published over HTTP and exported to a committed file.
- **Documented Operation**: One method and path pair, with its parameters, request body, responses,
  headers, and failure codes. Corresponds one-to-one with a route the service serves.
- **Shared Schema Component**: A structure described once and referenced wherever it appears, covering
  the order representation, the line item, the listing envelope, and the error body.
- **Failure Code Catalogue**: The complete set of machine-readable failure codes, sourced from the
  service's own declaration rather than restated.
- **Documentation Setting**: The single configuration value that decides whether the page and document
  are served, alongside the existing settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every operation the service routes appears in the published document and every operation
  in the document is routed by the service. Zero undocumented routes and zero documented non-routes,
  measured by comparison against the service's own route table.
- **SC-002**: Every machine-readable failure code the service can emit appears in the document. Zero
  omissions.
- **SC-003**: For every documented failure, provoking it against the running service produces exactly
  the documented status code and failure code, in 100% of documented cases.
- **SC-004**: Zero documented monetary fields are typed or exemplified as non-integers, and zero
  documented timestamp fields are typed or exemplified as formatted dates.
- **SC-005**: A reviewer who has not seen the system can place an order, read it back, list orders,
  and cancel one, using only a browser and the documented start-up and seed commands, in under five
  minutes.
- **SC-006**: Changing a single validation bound in the implementation changes the published document
  with no separate edit, proven by mutating each documented bound in turn.
- **SC-007**: Mounting the documentation changes no existing response. The status code, body, and
  headers of every pre-existing endpoint are identical with documentation enabled and disabled, and
  every pre-existing test passes without modification.
- **SC-008**: The exported document is a valid OpenAPI document that loads in an independent viewer
  with zero unresolved references.
- **SC-009**: The committed export and the document the implementation produces are identical, and the
  check reports a difference when they are not.
- **SC-010**: With documentation disabled, the documentation paths report not found and the full
  pre-existing test suite still passes.
- **SC-011**: Removing any single documentation guarantee turns the suite red, measured by mutating
  each guarantee in turn and confirming at least one test fails.
- **SC-012**: The full test suite produces identical results on two consecutive runs and stays within
  the advisory two-minute verification budget Spec 001 set in its SC-003, as amended by Spec 003's
  SC-009. This feature's tests are additive, so the relevant measurement is the increment they add.

## Assumptions

- The API surface being documented is exactly the one Spec 003's contract and Spec 001's health
  contract define. This specification does not extend, reinterpret, or correct either. Where the two
  disagree with the running service, the running service is the fact and the disagreement is a defect
  in the earlier specification, to be raised rather than papered over here.
- The system remains unauthenticated and single-tenant. The documentation therefore describes an open
  API, and the question of documenting a credential scheme resolves to documenting its absence.
- Documentation is served by the same process as the API, on the same port and origin. There is no
  separate documentation host, no static site build, and no publishing step.
- Serving documentation is enabled by default. The whole system is unauthenticated within its declared
  scope, so gating the page behind a setting that defaults to off would protect nothing while removing
  the reviewer's first useful surface. The setting exists so that a future deployment outside this
  scope can turn it off without a code change.
- The `customers` and `products` tables remain the Spec 002 placeholders with no HTTP surface, so the
  document describes no endpoint over them. Prefilled examples assume the identifiers the existing
  seeding command creates.
- The documented example values are illustrative and are not asserted to exist in any particular
  database. Their internal arithmetic is asserted; their resolvability is not.
- Adding a documentation capability requires a dependency the project does not currently have. This is
  accepted as inherent to the feature rather than treated as a deviation, and the choice of which one
  belongs to the planning phase.
- The document describes a single API version. There is no version negotiation, no deprecation
  lifecycle, and no historical version to publish alongside the current one.
- Rendering the page in a browser is a manual concern. Automated verification targets the document and
  the service's behaviour, not the page's visual appearance, because a test that asserts against
  rendered markup tests the documentation tool rather than this system.

## Out of Scope

- Any change to the order data model, to business workflows, to validation rules, or to what any
  endpoint returns. Where this specification appears to require such a change, the specification is
  wrong.
- Any new endpoint, field, parameter, status code, or failure code introduced to make documentation
  tidier.
- Authentication, authorisation, API keys, rate limiting, and quotas, which remain out of scope
  system-wide. Documenting their absence is in scope; introducing any of them is not.
- Client library generation, published SDKs, and a package release process. The exported document is
  the deliverable; what anyone generates from it is theirs.
- A hosted or published documentation site, a documentation build pipeline, and versioned
  documentation history.
- API versioning policy, deprecation markers, and sunset headers. There is one version and no
  predecessor.
- Customising, theming, or replacing the interactive page's appearance.
- Documenting internal modules, database schema, background job internals, or anything that is not
  reachable over HTTP.
- Request or response examples that are guaranteed to resolve against a live database. Examples
  illustrate shape and arithmetic, not existing rows.
