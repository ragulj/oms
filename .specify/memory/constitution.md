<!--
Sync Impact Report
==================
Version change: TEMPLATE (unversioned) -> 1.0.0
Bump rationale: Initial ratification. No prior versioned constitution existed; the
file on disk was the unfilled scaffold copied by `specify init`.

Principle mapping (placeholder -> ratified name):
  [PRINCIPLE_1_NAME] -> I. Centralized State Machine
  [PRINCIPLE_2_NAME] -> II. Lock-Free Atomic Transitions
  [PRINCIPLE_3_NAME] -> III. Bounded Background Processing
  [PRINCIPLE_4_NAME] -> IV. Exact-Integer Money and Immutable History
  [PRINCIPLE_5_NAME] -> V. Two-Phase Keyset Reads
  (added, no placeholder) -> VI. Integration-Proven Verification

Added sections:
  [SECTION_2_NAME] -> Scope and Technical Constraints
  [SECTION_3_NAME] -> Development Workflow and Quality Gates

Removed sections: none

Downstream artifacts reviewed:
  .specify/templates/plan-template.md - reads this file at runtime for the
    Constitution Check gate; no edit required
  .specify/templates/spec-template.md - no constitution-coupled placeholders
  .specify/templates/tasks-template.md - no constitution-coupled placeholders

Deferred TODOs: none
-->

# Order Processing System Constitution

## Core Principles

### I. Centralized State Machine

Every order status change MUST resolve through a single centralized state machine module
that owns the complete set of legal transitions. Controllers, services, jobs, and event
handlers MUST delegate to it and MUST NOT contain `switch` statements, `if` ladders, or any
other inline transition logic over order status. An illegal transition MUST be rejected by
the state machine itself, not by the caller.

Rationale: Transition rules replicated across call sites drift apart. One authority means a
new status or a new edge is added in exactly one place, and the legal graph is readable as a
single artifact rather than reconstructed from scattered branches.

### II. Lock-Free Atomic Transitions

Persisting a status change MUST be a single conditional statement that names both the
identity and the expected current state, in the shape
`UPDATE orders SET status = $next WHERE id = $1 AND status = $expected`. Read-then-write
sequences and pessimistic row locks MUST NOT be used to guard request-path transitions.
An update affecting zero rows MUST be surfaced as HTTP 409 Conflict. It MUST NOT be
reported as 404 or 500, and MUST NOT be silently retried into success.

Rationale: The database is the only component that can settle a concurrent race. Making the
expected state part of the WHERE clause turns the race into a deterministic row count, and
409 tells the caller the truth: the order moved underneath them.

### III. Bounded Background Processing

The scheduled job that promotes `pending` orders to `processing` on a 5-minute cadence MUST
NOT issue an unbounded UPDATE. It MUST claim work in bounded chunks using a Common Table
Expression that selects candidate rows with `FOR UPDATE SKIP LOCKED`, and MUST enforce a
hard cap on iterations per tick. When the cap is reached the tick MUST return, leaving the
remaining backlog for the next tick.

Rationale: An unbounded UPDATE holds locks across the whole table and stalls every concurrent
request. `SKIP LOCKED` lets overlapping ticks and multiple instances cooperate without
blocking, and the iteration cap guarantees a tick cannot monopolise the Node.js event loop.

### IV. Exact-Integer Money and Immutable History

All monetary values (unit prices, line totals, order totals) MUST be stored, computed, and
transported as integers denominated in the currency's minor unit. Floating point types MUST
NOT appear anywhere on a money path: not in the schema, not in DTOs, not in intermediate
arithmetic. Order line items MUST capture the price as of the moment the order was placed,
and historical line items MUST be immutable, enforced at the database level by constraint or
trigger rather than by application convention.

Rationale: Binary floating point cannot represent decimal money exactly, and rounding error
compounds silently across totals. Database-level immutability is what actually holds: an
application-layer rule is one forgotten code path away from rewriting financial history when
the catalog price changes.

### V. Two-Phase Keyset Reads

Listing orders with their line items MUST use two queries: first fetch the page of order IDs
using keyset pagination, then fetch line items for exactly those IDs. A single `LEFT JOIN`
with `LIMIT` MUST NOT be used for paginated listing. Cursors MUST preserve the full
microsecond precision of the ordering timestamp and MUST carry a unique tiebreaker column so
the sort is totally ordered. Cursor values MUST NOT be round-tripped through a JavaScript
`Date`, which truncates to milliseconds.

Rationale: Joining before limiting forces the database to materialise the full cartesian
product and paginate in memory, so cost grows with line items per order rather than with page
size. Millisecond truncation makes rows sharing a timestamp either repeat across pages or
vanish between them.

### VI. Integration-Proven Verification

Tests MUST be isolated. Every test MUST truncate the tables it touches in `beforeEach`, and
assertions MUST NOT depend on global row counts, seeded fixtures shared across files, or any
other cross-test state. Every core claim in this constitution MUST be backed by an
integration test that exercises the failure mode it prevents, including concurrent
transitions racing on the same order, precision boundaries on money arithmetic, cursor
behaviour at identical timestamps, and rejection of writes to historical line items.

Rationale: These guarantees are concurrency and precision guarantees. A unit test with a
mocked repository cannot observe a lost update or a truncated timestamp, so only an
integration test against a real database is evidence that the rule holds.

## Scope and Technical Constraints

The system operates in a single country with a single currency. Multi-currency support,
currency conversion, and exchange rate handling are strictly out of scope. Schemas MUST NOT
carry currency code columns or conversion tables in anticipation of a requirement that has
been ruled out.

The runtime is Node.js with NestJS. The datastore MUST support Common Table Expressions,
`FOR UPDATE SKIP LOCKED`, and timestamps with microsecond resolution. PostgreSQL is the
reference implementation; any substitute MUST satisfy all three capabilities, because
Principles III and V are unimplementable without them.

## Development Workflow and Quality Gates

The integration suite MUST fail the build when zero tests run. A green result from an empty
or fully skipped suite is treated as a build failure, not a pass.

Code review MUST verify, for every change touching these areas:

- No order status transition logic outside the centralized state machine.
- No status write that omits the expected-state predicate, and no zero-row result mapped to
  anything other than 409.
- No unbounded UPDATE or uncapped loop in any scheduled job.
- No floating point type on a money path.
- No `LEFT JOIN` plus `LIMIT` used for paginated listing, and no millisecond-truncated cursor.
- No test that leaks state or asserts against global counts.

Any deviation MUST be recorded with its justification in the Complexity Tracking section of
the implementation plan before the code is merged. Undocumented deviations are rejected in
review regardless of merit.

## Governance

This constitution supersedes all other development practices for this project. Where a
framework convention, a library default, or a generated scaffold conflicts with a principle
here, the principle wins.

Amendments require a documented rationale, a version bump under the policy below, and an
update to any specification or plan the change invalidates. Amendments MUST NOT be made
inside a feature branch as a way to unblock that feature.

Versioning policy:

- MAJOR: a principle is removed, or redefined in a way that invalidates compliant code.
- MINOR: a principle or section is added, or existing guidance is materially expanded.
- PATCH: clarification, wording, or typo fixes that do not change what is required.

Compliance is reviewed at two gates: the Constitution Check performed during
`/speckit-plan`, and every code review. Both MUST cite the specific principle when rejecting
a change.

**Version**: 1.0.0 | **Ratified**: 2026-09-05 | **Last Amended**: 2026-09-05
