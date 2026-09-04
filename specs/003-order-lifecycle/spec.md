# Feature Specification: Order Lifecycle and Processing

**Feature Branch**: `003-order-lifecycle`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Create Spec 003: Order Lifecycle and Processing. Define the complete Order flow: Create Order, Get Order, List Orders, Order State Transitions, Cancel Order, Background Order Processing. Cover functional behavior, validation, failure cases, concurrency, idempotency, and observability. For List Orders preserve bounded-memory pagination. For state changes preserve the centralized state-machine and atomic-transition requirements. For background processing define five-minute scheduled processing, bounded batching, single-query concurrency-safe row claiming, no unbounded loop. Include happy paths, isolation/failure paths, and teardown/test expectations. Do not redefine the Order or Order Line Item data model from Spec 002."

This specification defines the behaviour built on top of the data model Spec 002 established. It
consumes that model through [contracts/persistence.md](../002-order-entities/contracts/persistence.md)
and discharges the three obligations recorded there: O1 (an order and its lines in one transaction),
O2 (derive the total, fail loudly rather than round), and O3 (decide which transitions are legal).

It does not restate, extend, or weaken the Order or Order Line Item data model. Where a guarantee
already holds at the storage layer, this specification relies on it rather than re-checking it.

## Clarifications

### Session 2026-09-05

- Q: How does the system prevent a duplicate order when a client retries a request whose response it
  never saw? → A: An optional `Idempotency-Key` request header, recorded in the same transaction that
  creates the order and replayed on repeat. Chosen because Constitution Principle IV makes a stored
  order permanent: a duplicate created by a network retry can never be deleted, only cancelled, so
  refusing it at the door is the only remedy this system actually has.
- Q: Which status transitions are legal? → A: exactly `pending → processing` and `pending →
  cancelled`. Nothing leaves `processing` or `cancelled` within this scope. Chosen because the status
  set carries no completion or compensation value, so a cancellation after promotion would leave a
  state the model cannot describe; and because it gives the state machine a business-meaningful edge
  to refuse rather than only self-loops.
- Q: How do the placeholder `customers` and `products` tables get populated, given Spec 002 records
  that they are replaced rather than extended? → A: they remain data dependencies with no HTTP
  surface. A seeding command populates them for local use and prints the identifiers it created;
  tests use fixtures. Order creation rejects identifiers that do not resolve. Chosen because Spec
  002's contract states only their `id` columns survive, so any endpoint built over them is work that
  gets discarded.
- Q: Is repeating a cancellation on an already-cancelled order a success or a conflict? → A: a
  conflict. Reporting success would mean reporting a change that did not happen, and deciding it
  would require the read-then-write guard Constitution Principle II forbids on the request path.
- Q: How does a caller distinguish "no such order" from "the order moved underneath you", given that
  both produce a zero changed-row count? → A: the conditional update is issued first; only when it
  reports zero changed rows is the row read, and only to classify the failure. The read happens after
  the write attempt, so it cannot cause a lost update.
- Q: How is concurrency proven, on an engine that admits one writer and a driver that is synchronous?
  → A: by driving both statements of a race from one process in both interleavings and asserting that
  the second observes the first's effect through its changed-row count. The guarantee under test is
  that the predicate settles the race; a thread-level race would not test anything the predicate does
  not already decide.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Place an Order (Priority: P1)

A customer service operator submits an order naming a customer and one or more products with
quantities. The system captures what each product costs at that moment, stores the order and every
line as one indivisible unit, and returns the stored order with its identifier, its status, and its
total. Nothing the caller sends can influence the price recorded.

**Why this priority**: Nothing else in this specification has anything to act on until orders can be
placed. It is also where the money enters the system, so it is where price capture, exact-integer
arithmetic, and all-or-nothing writing have to hold.

**Independent Test**: Submit a well-formed order and confirm a stored order comes back carrying the
catalog price rather than any price the caller supplied, with every line present and a total that
equals the sum of the line totals read back from storage. Delivers a working intake path on its own.

**Acceptance Scenarios**:

1. **Given** an existing customer and two existing products, **When** an order is submitted naming
   both products with quantities, **Then** a new order is stored with status `pending`, both line
   items, and a total equal to the sum of the stored line totals.
2. **Given** a product whose catalog price is later changed, **When** the earlier order is read back,
   **Then** it still reports the price captured when it was placed.
3. **Given** an order request naming one valid product and one that does not exist, **When** it is
   submitted, **Then** the request is rejected and no order, and no line item, is stored.
4. **Given** an order request that supplies its own unit price, order total, status, or timestamp,
   **When** it is submitted, **Then** the request is rejected rather than silently ignoring the field.
5. **Given** an order request with an empty line item list, **When** it is submitted, **Then** the
   request is rejected.
6. **Given** a request carrying an idempotency key, **When** the identical request is submitted
   again, **Then** the original order is returned and no second order exists.

---

### User Story 2 - Retrieve an Order (Priority: P2)

Anyone holding an order identifier can read the complete order back: its status, its timestamps, every
line item with the price captured at placement, and the order total derived from those lines.

**Why this priority**: An order that cannot be read back is not evidence that anything was stored
correctly. This is the smallest addition that makes User Story 1 verifiable from outside the system.

**Independent Test**: Place an order, read it by its identifier, and confirm every field matches what
was stored, including a total that is derived on read rather than persisted.

**Acceptance Scenarios**:

1. **Given** a stored order, **When** it is fetched by identifier, **Then** the order, all of its line
   items in a deterministic order, and its derived total are returned.
2. **Given** an identifier that matches no order, **When** it is fetched, **Then** the response
   reports that the order was not found.
3. **Given** an identifier that is not a positive whole number, **When** it is fetched, **Then** the
   request is rejected as malformed rather than reported as not found.
4. **Given** an order whose lines were placed with differing prices, **When** it is fetched, **Then**
   the total equals the exact integer sum of those lines with no rounding.

---

### User Story 3 - List Orders (Priority: P3)

An operator pages through orders newest first, optionally narrowed to a single status, and receives
each order with its line items. Paging works the same on a table of ten orders and a table of ten
thousand, and the work done per request depends on the page size rather than on how many orders exist.

**Why this priority**: Listing is the read path that fails quietly rather than loudly. A naive
implementation returns correct-looking pages while duplicating rows across page boundaries and reading
the whole table into memory to do it.

**Independent Test**: Seed ten thousand orders, page through all of them, and confirm every order
appears exactly once with no duplicates and no omissions, including across orders that share a
creation timestamp, while both underlying queries are served by an index rather than a scan.

**Acceptance Scenarios**:

1. **Given** more orders than fit on one page, **When** the first page is requested, **Then** the
   newest orders are returned with a cursor for continuing.
2. **Given** a cursor from a previous page, **When** the next page is requested, **Then** it continues
   exactly where the previous page ended, with no repeated and no skipped order.
3. **Given** several orders sharing the same creation timestamp, **When** the listing is paged
   through, **Then** each of them appears exactly once and their relative order is stable.
4. **Given** the same cursor, **When** the page is requested twice with no intervening writes,
   **Then** both responses are identical.
5. **Given** a request that supplies a page offset instead of a cursor, **When** it is submitted,
   **Then** it is rejected rather than silently ignored.
6. **Given** a malformed cursor, **When** it is submitted, **Then** the request is rejected rather
   than being treated as no cursor at all.
7. **Given** a status filter, **When** the listing is requested, **Then** only orders in that status
   are returned, still newest first and still keyset paged.

---

### User Story 4 - Cancel an Order and Refuse Illegal Transitions (Priority: P4)

An operator cancels an order that has not yet been picked up for processing. An order that has already
been promoted, or that is already cancelled, cannot be cancelled again, and the refusal is the state
machine's decision rather than a check written at the call site. Two operators cancelling the same
order at the same moment produce exactly one success.

**Why this priority**: This is where the two hardest guarantees in the constitution meet: one
authority over the transition graph, and a race settled by the database rather than by application
logic. It is also the only place an order's status changes in response to a request.

**Independent Test**: Cancel a pending order and confirm success; cancel it again and confirm a
conflict; cancel a promoted order and confirm a conflict; drive two cancellations against one pending
order and confirm exactly one succeeds. No other endpoint is needed to prove any of this.

**Acceptance Scenarios**:

1. **Given** a pending order, **When** it is cancelled, **Then** the response reports success and the
   stored order is `cancelled` with a refreshed update timestamp and an unchanged creation timestamp.
2. **Given** an order already `cancelled`, **When** cancellation is attempted again, **Then** the
   response reports a conflict naming the current status, and nothing changes.
3. **Given** an order already `processing`, **When** cancellation is attempted, **Then** the response
   reports a conflict, and nothing changes.
4. **Given** an identifier matching no order, **When** cancellation is attempted, **Then** the
   response reports that the order was not found rather than a conflict.
5. **Given** one pending order, **When** two cancellations are applied in sequence against the same
   expected state, **Then** exactly one reports a change and the other reports none.
6. **Given** a cancelled order, **When** its line items are examined, **Then** they are byte-for-byte
   what was stored at placement, and none has been removed.

---

### User Story 5 - Promote Pending Orders in the Background (Priority: P5)

Without anyone asking, the system moves pending orders into processing on a five-minute cadence. It
takes them oldest first, in bounded chunks, and stops after a fixed number of chunks even when more
work remains, leaving the rest for the next tick. A large backlog therefore drains over several ticks
rather than in one long operation that holds the write lock and blocks the process.

**Why this priority**: It depends on the state machine from User Story 4 and on orders existing from
User Story 1, so it is last. Its own guarantee is the opposite of the others: the requirement is that
it does *not* finish the work when the work is large.

**Independent Test**: Seed a backlog larger than one tick can drain, run a single tick directly, and
confirm it promoted exactly the configured chunk size times the configured cap, no more, with the
remainder still pending and each chunk committed separately.

**Acceptance Scenarios**:

1. **Given** a backlog smaller than one chunk, **When** a tick runs, **Then** every pending order
   becomes `processing` and the tick ends early rather than running its full cap of iterations.
2. **Given** a backlog larger than chunk size times iteration cap, **When** a tick runs, **Then**
   exactly chunk size times iteration cap orders are promoted and the rest remain `pending`.
3. **Given** a backlog containing cancelled orders, **When** a tick runs, **Then** no cancelled order
   changes status, and the exclusion comes from the statement's own predicate.
4. **Given** orders with differing creation timestamps, **When** a partial tick runs, **Then** the
   oldest pending orders are the ones promoted.
5. **Given** a tick still running, **When** the next tick is due, **Then** it is skipped and the skip
   is recorded rather than the two running concurrently.
6. **Given** a shutdown in progress, **When** a tick is due, **Then** no new tick begins.
7. **Given** an empty backlog, **When** a tick runs, **Then** it performs one claim, finds nothing,
   and ends without error.

---

### Edge Cases

- What happens when an order's line totals are individually valid but their sum exceeds the exactly
  representable integer ceiling? The order must never be stored, and the failure must be explicit
  rather than a rounded total.
- What happens when the same product appears on several lines of one order? It is permitted, and each
  line is priced and totalled independently.
- What happens when a quantity is supplied as a decimal, a numeric string, or a value beyond the
  representable integer range? The request is rejected before any write.
- What happens when the customer exists but one product identifier does not? Nothing is written, not
  even the order row.
- What happens when a cursor is replayed after the referenced order has been cancelled? The page is
  still positionally valid; cancellation does not remove rows, so the sequence is unbroken.
- What happens when an idempotency key is reused with a different request body? The request is
  refused as a conflict, and no order is created, because silently returning the earlier order would
  answer a question the caller did not ask.
- What happens when two requests carrying the same idempotency key arrive together? At most one order
  is created, and the constraint that guarantees it lives in the database rather than in a check
  performed before the write.
- What happens when a page is requested with a limit above the permitted maximum? The request is
  rejected rather than quietly clamped, so a caller never believes it received more than it did.
- What happens when the background job encounters a failing chunk mid-tick? Chunks already committed
  stay committed, the tick ends, and the failure is recorded. The next tick resumes from what remains.
- What happens when an order is cancelled in the instant between the background job selecting its
  identifier and updating it? The update's own status predicate excludes it, so it is not promoted and
  the claimed count reflects that.
- What happens when the scheduler interval, chunk size, or iteration cap is configured as zero or
  negative? The process refuses to start, as it already does for every other invalid setting.
- What happens when a request supplies both a cursor and a status filter that disagree with the
  cursor's origin page? The filter is applied to the whole listing; the cursor only positions within
  it. A caller changing filters mid-page starts a new listing.

## Requirements *(mandatory)*

### Functional Requirements

#### Shared request and response behaviour

- **FR-001**: All order endpoints MUST be served under the existing versioned prefix `/api/v1`. The
  health endpoint MUST remain outside it, unchanged.
- **FR-002**: Every request body MUST be validated before any database access occurs.
- **FR-003**: Any property not defined by the endpoint's request contract MUST cause rejection. An
  unrecognised field MUST NOT be silently discarded.
- **FR-004**: Every error response MUST carry a stable machine-readable code, a human-readable
  message, and the request's correlation identifier.
- **FR-005**: The only status codes any order endpoint returns are 200, 201, 400, 404, 409, and 500.
  No endpoint MUST return 500 for any input a caller can produce.
- **FR-006**: No error response MUST contain a stack trace, a database error string, a SQL fragment,
  or a filesystem path.
- **FR-007**: Every request MUST be assigned a correlation identifier, taken from a supplied
  `X-Correlation-Id` header when well formed and generated otherwise, and returned on the response.
- **FR-008**: Every monetary value on the wire MUST be a whole number of minor units. Decimal strings
  and fractional numbers MUST NOT appear on any money field in a request or a response.
- **FR-009**: Every timestamp on the wire MUST be an integer count of microseconds since the Unix
  epoch, matching storage exactly. No millisecond-resolution or formatted-string rendering of an
  ordering timestamp MUST be exposed, because a consumer would then be able to build a cursor from a
  truncated value.
- **FR-010**: Response bodies MUST expose only the documented fields. Internal columns and
  identifiers not part of the contract MUST NOT be returned.

#### Create Order

- **FR-011**: The system MUST accept an order creation request naming one customer and one or more
  line items, each identifying a product and a quantity.
- **FR-012**: A creation request MUST NOT be permitted to supply an order identifier, a status, a
  creation or update timestamp, a unit price, a line total, or an order total. Supplying any of them
  MUST be rejected rather than ignored.
- **FR-013**: A creation request with zero line items MUST be rejected.
- **FR-014**: Each quantity MUST be a whole number of at least 1 and at most a documented per-line
  maximum. Anything else MUST be rejected before any write.
- **FR-015**: An order MUST NOT exceed a documented maximum number of line items, so that a single
  request cannot make the derived total or the write unbounded.
- **FR-016**: A creation request naming a customer that does not exist MUST be rejected, and the
  rejection MUST identify which field was unresolvable.
- **FR-017**: A creation request naming any product that does not exist MUST be rejected, and no order
  and no line item MUST be stored.
- **FR-018**: The unit price stored on each line MUST be read from the product catalog at the moment
  of creation. The caller MUST have no way to influence it.
- **FR-019**: The product description stored on each line MUST likewise be captured from the catalog
  at the moment of creation.
- **FR-020**: The order row and all of its line items MUST be written in a single transaction, so no
  reader can observe an order with no lines. This discharges contract obligation O1.
- **FR-021**: A newly created order MUST have status `pending`.
- **FR-022**: A newly created order's creation and update timestamps MUST be set from one
  server-derived microsecond value, and MUST be equal to each other.
- **FR-023**: A successful creation MUST respond with 201 and the stored order representation,
  including a location for retrieving it.
- **FR-024**: The order total MUST be derived by summing the line totals the database computed, never
  by multiplying and summing the request's own numbers. This discharges contract obligation O2.
- **FR-025**: If the derived total would exceed the exactly representable integer ceiling, the
  creating transaction MUST be aborted and the request rejected. An order whose total cannot be
  represented exactly MUST NOT be stored, and the failure MUST NOT be a rounded value.
- **FR-026**: The same product appearing on more than one line of an order MUST be permitted, each
  line priced and totalled independently.
- **FR-027**: Creation MUST fail as a whole if any part fails. Partial orders MUST NOT be observable
  at any point, including by a concurrent reader.

#### Idempotent creation

- **FR-028**: The creation endpoint MUST accept an optional idempotency key header.
- **FR-029**: When no key is supplied, no replay protection applies and each request creates an order.
  This MUST be stated in the endpoint's documentation rather than left implicit.
- **FR-030**: A supplied key MUST conform to a documented length and character range. A malformed key
  MUST be rejected.
- **FR-031**: The key, a fingerprint of the request body, and the identifier of the resulting order
  MUST be recorded in the same transaction that creates the order. A key MUST NOT be recorded for an
  order that was not created.
- **FR-032**: A repeat request carrying a key already recorded, with a matching body fingerprint, MUST
  return the originally created order and MUST NOT create a second one. The response MUST be
  distinguishable from the original creation.
- **FR-033**: A repeat request carrying a key already recorded, with a differing body fingerprint,
  MUST be rejected as a conflict, and no order MUST be created.
- **FR-034**: Two creation requests carrying the same key MUST NOT both create an order. The guarantee
  MUST come from a uniqueness constraint enforced by the database, not from a check performed before
  the write.
- **FR-035**: Each idempotency record MUST carry the microsecond timestamp at which it was written, so
  a later specification can expire records without a schema change.
- **FR-036**: The idempotency record table MUST be introduced by a committed migration generated from
  the schema definition, with no schema drift between the two.
- **FR-037**: The idempotency record table MUST permit row deletion, so per-test isolation clears it by
  deletion, which Constitution Principle VI requires wherever deletion is available.

#### Get Order

- **FR-038**: The system MUST return a single order by its identifier, with all of its line items and
  its derived total.
- **FR-039**: An identifier that is not a positive whole number MUST be rejected as malformed, not
  reported as not found.
- **FR-040**: An identifier matching no order MUST be reported as not found.
- **FR-041**: Line items MUST be returned in a deterministic order that is the same on every read.
- **FR-042**: The order total MUST be derived on read. No stored total column MUST be introduced.
- **FR-043**: The line item array MUST never be empty, which follows from FR-020 rather than from a
  defensive check.

#### List Orders

- **FR-044**: The system MUST return a page of orders, newest first, each with its line items and
  derived total.
- **FR-045**: Listing MUST issue exactly two queries: one for the page of order identifiers, then one
  for the line items belonging to exactly those identifiers. A join followed by a limit MUST NOT be
  used.
- **FR-046**: Page size MUST be caller-controllable within a documented default and maximum. A value
  outside the permitted range MUST be rejected rather than clamped.
- **FR-047**: Pagination MUST be keyset. An offset or page-number parameter MUST NOT be accepted;
  supplying one MUST be rejected.
- **FR-048**: The cursor MUST be opaque to the caller and MUST carry both the full microsecond
  timestamp and the unique tiebreaker, so the sort is totally ordered.
- **FR-049**: A cursor MUST NOT be produced or consumed by way of any representation that truncates
  the timestamp below microsecond resolution.
- **FR-050**: A malformed or undecodable cursor MUST be rejected. It MUST NOT be treated as an absent
  cursor.
- **FR-051**: A response MUST carry a continuation cursor when further rows may exist and MUST report
  its absence on the final page.
- **FR-052**: Paging the entire table MUST yield every order exactly once, with no duplicates and no
  omissions, including across orders that share a creation timestamp.
- **FR-053**: The same cursor MUST produce the same page on repeated requests when no writes have
  intervened.
- **FR-054**: The work performed and memory held per listing request MUST be bounded by the page size,
  not by the number of stored orders. No listing path MUST fetch an unbounded row set.
- **FR-055**: Both listing queries MUST be served by an index rather than a table scan, verified by
  inspecting the database's own execution plan against a table large enough to distinguish the two.
- **FR-056**: An optional status filter MUST be supported, restricted to the known statuses. An
  unknown value MUST be rejected.
- **FR-057**: Orders created after a page was produced MUST NOT cause rows to repeat or disappear on
  subsequent pages of the same traversal.

#### Order state machine

- **FR-058**: One module MUST own the complete set of legal status transitions. No controller,
  service, job, or handler MUST contain transition logic over order status.
- **FR-059**: The legal transitions MUST be exactly `pending → processing` and `pending → cancelled`.
  Every other ordered pair over the status set, including every self-transition, MUST be illegal.
- **FR-060**: The module MUST expose, for a target status, the set of source statuses from which it is
  reachable, so a caller can build its conditional predicate without restating the rules.
- **FR-061**: The module MUST itself reject an illegal transition. A caller MUST NOT be required to
  pre-filter, and MUST NOT be able to bypass the module by writing a status directly.
- **FR-062**: Adding a status or an edge MUST require a change to this module and to nothing else.
- **FR-063**: The transition graph MUST be asserted exhaustively over every ordered pair of statuses,
  so a status added without declaring its edges fails a test rather than passing silently.
- **FR-064**: No endpoint MUST accept an arbitrary target status. There MUST be no generic status
  update path.

#### Applying a transition

- **FR-065**: Every persisted status change MUST be a single conditional statement naming both the
  order identity and the expected source status, in the shape Constitution Principle II mandates.
- **FR-066**: A read of the current status followed by a write MUST NOT be used to guard a
  request-path transition.
- **FR-067**: The outcome MUST be decided from the reported changed-row count and from nothing else.
- **FR-068**: A changed-row count of one MUST be reported as success. A count of zero MUST be reported
  as a conflict, MUST NOT be reported as not found or as a server error, and MUST NOT be retried into
  success.
- **FR-069**: When the count is zero, the order row MAY be read once, after the write attempt and
  solely to classify the failure: absent means not found, present means conflict. This read MUST NOT
  occur before the write.
- **FR-070**: A conflict response MUST name the order's current status and the attempted target.
- **FR-071**: The update timestamp MUST be refreshed by the database, as Spec 002 guarantee G11
  provides. No caller MUST write it, and no transition statement MUST assign it.

#### Cancel Order

- **FR-072**: The system MUST expose a dedicated cancellation action for a single order, taking no
  request body.
- **FR-073**: Cancelling a `pending` order MUST succeed and MUST return the updated order.
- **FR-074**: Cancelling a `processing` order MUST be refused as a conflict.
- **FR-075**: Cancelling an already `cancelled` order MUST be refused as a conflict.
- **FR-076**: Cancelling an order that does not exist MUST be reported as not found.
- **FR-077**: Cancellation MUST NOT delete the order or any of its line items, and MUST NOT alter any
  stored monetary value.
- **FR-078**: Two cancellations applied against the same pending order MUST produce exactly one change
  and exactly one conflict, decided by the changed-row count rather than by ordering in application
  code.
- **FR-079**: A cancellation and a background promotion applied to the same pending order MUST result
  in exactly one of `cancelled` or `processing`, never both applied and never neither.

#### Background order processing

- **FR-080**: A scheduled job MUST promote `pending` orders to `processing` on a cadence of five
  minutes by default, with the interval configurable and required to be positive.
- **FR-081**: This job MUST replace the placeholder heartbeat task introduced by Spec 001, which MUST
  be removed rather than left registered alongside it.
- **FR-082**: Each iteration MUST claim a bounded chunk by selecting a capped set of order identifiers
  and updating exactly those rows, with the expected status re-asserted in the outer predicate, in the
  shape Constitution Principle III mandates.
- **FR-083**: The chunk size MUST be configurable, MUST be positive, and MUST have a documented
  default.
- **FR-084**: A hard iteration cap per tick MUST be enforced. Reaching it MUST end the tick and leave
  the remaining backlog for the next one. The cap MUST be configurable and positive.
- **FR-085**: A tick MUST also end when an iteration claims zero rows.
- **FR-086**: Each chunk MUST commit in its own transaction. A single write transaction MUST NOT span
  more than one chunk, and MUST NOT span a whole tick.
- **FR-087**: Against a backlog larger than chunk size times iteration cap, one tick MUST promote
  exactly chunk size times iteration cap orders and MUST leave the remainder `pending`.
- **FR-088**: The target status MUST be obtained from the state machine. The job MUST NOT write a
  status literal of its own.
- **FR-089**: Orders MUST be claimed oldest first by creation timestamp.
- **FR-090**: A `cancelled` order MUST never be promoted, and the exclusion MUST come from the
  statement's own status predicate rather than from a filter applied after reading.
- **FR-091**: Ticks MUST NOT overlap. A tick still running when the next is due MUST cause that tick to
  be skipped, and the skip MUST be recorded.
- **FR-092**: No new tick MUST begin once shutdown has started, and an in-flight tick MUST be allowed
  to finish within the existing drain window.
- **FR-093**: A tick MUST be directly invocable so its behaviour can be exercised without waiting for
  the schedule.
- **FR-094**: A failure part-way through a tick MUST leave already-committed chunks committed, MUST end
  the tick, and MUST be recorded. It MUST NOT roll back completed work and MUST NOT crash the process.

#### Observability

- **FR-095**: Each created order MUST produce a structured record carrying at least the correlation
  identifier, the order identifier, the line count, and the derived total.
- **FR-096**: Each transition attempt MUST produce a structured record carrying the order identifier,
  the source and target statuses, and whether the change was applied or refused.
- **FR-097**: Each tick MUST produce a structured record carrying the number of iterations run, the
  number of orders promoted, whether the iteration cap was reached, and the elapsed duration.
- **FR-098**: Every rejected request MUST produce a structured record, at warning level for a caller
  fault and at error level for an unexpected fault.
- **FR-099**: Every record MUST remain a single line of machine-parseable structured output, and MUST
  continue to pass through the existing redaction of sensitive fields.
- **FR-100**: A record MUST NOT contain a full request body or a full header set.

#### Verification, isolation, and teardown

- **FR-101**: Every requirement above MUST be exercised against a real database through the real
  application graph, not against a mocked repository.
- **FR-102**: Any table this specification introduces MUST be declared in the test harness's isolation
  lists, so per-test cleanup covers it by the mechanism Constitution Principle VI requires for that
  table.
- **FR-103**: Concurrency requirements MUST be proven by driving both statements of the race in both
  interleavings and asserting on the changed-row counts, since the engine admits a single writer and
  the property under test is that the predicate settles the race.
- **FR-104**: Tests MUST NOT depend on elapsed wall-clock time to observe scheduled behaviour.
- **FR-105**: Every test MUST observe only the rows it created and MUST produce the same outcome run
  alone as in the full suite.
- **FR-106**: The suite MUST continue to fail the build when zero tests run.
- **FR-107**: Removing any single guarantee named in these requirements MUST turn the suite red. A
  guarantee no test detects the absence of is not considered verified.

### Key Entities

- **Order**: Defined by Spec 002 and not redefined here. This specification adds behaviour over it:
  how it comes into existence, how it is read, and which status changes it accepts.
- **Order Line Item**: Defined by Spec 002 and not redefined here. This specification writes them once
  at creation and never again.
- **Idempotency Record**: New. Associates a caller-supplied key with the fingerprint of the request
  that first used it and the identifier of the order that request created, plus the time it was
  written. Its uniqueness constraint is what makes duplicate creation impossible rather than unlikely.
- **Order Page Cursor**: New, and not persisted. An opaque encoding of the position at which a listing
  traversal continues, carrying the full-resolution ordering timestamp and the unique tiebreaker.
- **Transition Graph**: New, and not persisted. The complete set of legal status changes, held in one
  place, and the only authority on whether a change is permitted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An order can be placed and read back with an identical total, and the total is the exact
  integer sum of its lines with zero rounding error at every tested boundary.
- **SC-002**: Paging a table of 10,000 orders returns each order exactly once, with zero duplicates
  and zero omissions, including across orders deliberately sharing a creation timestamp.
- **SC-003**: The work performed per listing request is bounded by page size: at 10,000 stored orders
  both listing queries are served by an index seek and neither performs a full table scan.
- **SC-004**: Given two cancellation attempts against one pending order, exactly one reports success
  and exactly one reports a conflict, in 100% of trials and in either interleaving.
- **SC-005**: A single background tick against a backlog of 5,000 pending orders promotes exactly the
  configured chunk size times iteration cap and no more, leaving the remainder pending.
- **SC-006**: A creation request replayed with the same idempotency key produces exactly one stored
  order, whether the replay is sequential or interleaved with the original.
- **SC-007**: Every foreseeable invalid input produces a documented client-error status with a
  machine-readable code. No input a caller can construct produces a server error.
- **SC-008**: No operation defined by this specification changes or removes a stored line item, and no
  order that has been stored can be made to disappear.
- **SC-009**: The full test suite completes in under 60 seconds and produces identical results on two
  consecutive runs.
- **SC-010**: Removing any single guarantee from the implementation turns the suite red, measured by
  mutating each guarantee in turn and confirming at least one test fails.
- **SC-011**: A reviewer can go from a clean checkout to a created, retrieved, listed, and cancelled
  order using only the documented commands, with no undocumented setup step.
- **SC-012**: The longest uninterrupted unit of database work in a tick is one chunk, so total
  blocking per tick is bounded by chunk size times iteration cap and is independent of backlog size.

## Assumptions

- The system remains unauthenticated and single-tenant, as Spec 001 and Spec 002 assumed. There is no
  caller identity, so no authorisation rule constrains who may create or cancel an order.
- A single process runs against a single database file. The background job assumes it is the only
  scheduler running, as the constitution's scope section states.
- `customers` and `products` remain the placeholders Spec 002 created. This specification reads them
  and never writes them through an endpoint, on the basis that only their `id` columns survive into
  whichever specification eventually owns them. A seeding command populates them for local use.
- The status set stays exactly `pending`, `processing`, and `cancelled`. There is no completion,
  fulfilment, refund, or failure status, so `processing` is where the modelled lifecycle ends.
- Order identifiers remain sequential integers and therefore externally enumerable, which Spec 002's
  assumptions already accepted under the current unauthenticated scope.
- Idempotency keys are supplied by callers and are not validated for global uniqueness beyond the
  constraint that makes replay detectable. A caller reusing another caller's key is out of scope
  because there is no caller identity to scope keys by.
- Expiring old idempotency records is deferred. The timestamp needed to do it later is required now so
  that adding expiry needs no schema change.
- Wall-clock time advances monotonically enough for creation timestamps to be usable as an ordering
  key. Spec 002's update trigger already guarantees strict advancement even within a single clock tick.
- The five-minute cadence is a default, not a business rule. Nothing in the specification depends on
  the interval's exact value, and tests drive ticks directly rather than waiting for one.

## Out of Scope

- Any status beyond the three Spec 002 defined, and therefore any notion of completing, fulfilling,
  shipping, refunding, or failing an order.
- Payment, inventory, reservation, and any other side effect of promoting an order to `processing`.
  Promotion changes a status and nothing else.
- Authentication, authorisation, rate limiting, and quota enforcement.
- Creating, updating, or deleting customers and products through any interface.
- Multi-currency handling, which the constitution rules out globally.
- Multi-instance deployment, horizontal scaling, and read replicas, which the constitution rules out
  globally.
- Expiry or pruning of idempotency records.
- Order modification of any kind after creation. The only permitted change to a stored order is its
  status, through the transitions FR-059 declares.
