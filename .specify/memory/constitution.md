<!--
Sync Impact Report
==================
Version change: 1.0.0 -> 2.0.0
Bump rationale: MAJOR. Principle III previously mandated a CTE with
`FOR UPDATE SKIP LOCKED`. SQLite has no row-level locking, so that mechanism is
removed and replaced. Code written to comply with v1.0.0 is no longer compliant.
The datastore mandate also changes from a PostgreSQL-class engine to SQLite, and
the persistence layer is fixed to Drizzle ORM.

Modified principles (names unchanged, bodies amended):
  III. Bounded Background Processing
       - removed: CTE + FOR UPDATE SKIP LOCKED
       - added: bounded primary-key claim, per-chunk transactions, WAL + busy_timeout
  IV. Exact-Integer Money and Immutable History
       - narrowed: immutability enforced by SQLite trigger with RAISE(ABORT)
       - added: INTEGER column type mandate, REAL and NUMERIC prohibited
  V. Two-Phase Keyset Reads
       - narrowed: ordering timestamps stored as INTEGER microseconds since epoch
       - added: TEXT ISO-8601 and REAL julianday representations prohibited
  VI. Integration-Proven Verification
       - added: tests run against a real SQLite database; DELETE FROM in place of TRUNCATE
       - added: iteration-cap coverage requirement

Modified sections:
  Scope and Technical Constraints - rewritten for SQLite and Drizzle; capability
    floor replaced; single-process deployment constraint added
  Development Workflow and Quality Gates - review checklist updated for the new stack

Principles added: none (count unchanged at 6)
Sections removed: none

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
sequences MUST NOT be used to guard request-path transitions. The statement MUST be issued
through Drizzle as an explicit update, and the decision MUST be taken from the driver's
reported changed-row count. A change count of zero MUST be surfaced as HTTP 409 Conflict.
It MUST NOT be reported as 404 or 500, and MUST NOT be silently retried into success.

Rationale: The database is the only component that can settle a concurrent race. Making the
expected state part of the WHERE clause turns the race into a deterministic row count, and
409 tells the caller the truth: the order moved underneath them.

### III. Bounded Background Processing

The scheduled job that promotes `pending` orders to `processing` on a 5-minute cadence MUST
NOT issue an unbounded UPDATE. Each iteration MUST claim a bounded chunk by selecting a
capped set of primary keys and updating exactly those rows, re-asserting the expected status
in the outer predicate:

```sql
UPDATE orders SET status = 'processing'
WHERE id IN (SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at LIMIT :chunk)
  AND status = 'pending';
```

The job MUST enforce a hard cap on iterations per tick and MUST return once the cap is
reached, leaving the remaining backlog for the next tick. Each chunk MUST commit in its own
transaction. A tick MUST NOT hold one long-lived write transaction across chunks.

SQLite serialises writers at the database level, so there is no `SKIP LOCKED` and no need
for one. The connection MUST run in WAL mode with a non-zero `busy_timeout`, so readers are
never blocked by the job and a contended write waits rather than failing instantly.

Rationale: An unbounded UPDATE takes the single write lock for the length of the whole
backlog, which stalls every concurrent write for that entire duration. The iteration cap is
the harder constraint: the common SQLite drivers for Node are synchronous, so every chunk
blocks the event loop for as long as it runs. Chunk size and iteration cap are therefore not
tuning knobs, they are the safety property that keeps the process responsive.

### IV. Exact-Integer Money and Immutable History

All monetary values (unit prices, line totals, order totals) MUST be stored, computed, and
transported as integers denominated in the currency's minor unit, on columns declared
`INTEGER`. `REAL` and `NUMERIC` column affinities MUST NOT appear on a money path, and
floating point arithmetic MUST NOT be used to derive a monetary value in application code.

Order line items MUST capture the price as of the moment the order was placed. Historical
line items MUST be immutable, enforced by a SQLite trigger that calls `RAISE(ABORT, ...)` on
attempts to update the captured price. Enforcement MUST NOT rely on a Drizzle-level guard or
an application convention.

Rationale: Binary floating point cannot represent decimal money exactly, and rounding error
compounds silently across totals. SQLite's dynamic typing makes this worse, since a `REAL`
affinity will quietly coerce an integer you meant to keep exact. Database-level immutability
is what actually holds: an application-layer rule is one forgotten code path away from
rewriting financial history when the catalog price changes.

### V. Two-Phase Keyset Reads

Listing orders with their line items MUST use two queries: first fetch the page of order IDs
using keyset pagination, then fetch line items for exactly those IDs. A single `LEFT JOIN`
with `LIMIT` MUST NOT be used for paginated listing.

Ordering timestamps MUST be stored as `INTEGER` microseconds since the Unix epoch. TEXT
ISO-8601 strings and `REAL` julianday values MUST NOT be used on any column that
participates in ordering or in a cursor. Cursors MUST carry the full microsecond value
together with a unique tiebreaker column so the sort is totally ordered, and MUST NOT be
round-tripped through a JavaScript `Date`, which truncates to milliseconds.

Rationale: Joining before limiting forces the database to materialise the full cartesian
product and paginate in memory, so cost grows with line items per order rather than with page
size. Millisecond truncation makes rows sharing a timestamp either repeat across pages or
vanish between them. Integer microseconds also stay exactly representable as a JavaScript
number well beyond any plausible lifetime of this system, so no BigInt handling is required.

### VI. Integration-Proven Verification

Tests MUST be isolated and MUST run against a real SQLite database rather than a mocked
repository. Every test MUST clear the tables it touches in `beforeEach`, using `DELETE FROM`
since SQLite has no `TRUNCATE`. Assertions MUST NOT depend on global row counts, seeded
fixtures shared across files, or any other cross-test state.

Every core claim in this constitution MUST be backed by an integration test that exercises
the failure mode it prevents, including concurrent transitions racing on the same order,
precision boundaries on money arithmetic, cursor behaviour at identical timestamps,
rejection of writes to historical line items, and a background tick honouring its iteration
cap against a backlog larger than that cap.

Rationale: These guarantees are concurrency and precision guarantees. A unit test with a
mocked repository cannot observe a lost update, a coerced `REAL`, or a truncated timestamp,
so only an integration test against a real database is evidence that the rule holds.

## Scope and Technical Constraints

The system operates in a single country with a single currency. Multi-currency support,
currency conversion, and exchange rate handling are strictly out of scope. Schemas MUST NOT
carry currency code columns or conversion tables in anticipation of a requirement that has
been ruled out.

The runtime is Node.js with NestJS. Persistence is SQLite, accessed exclusively through
Drizzle ORM:

- Drizzle schema modules are the single source of truth for the schema. Migrations MUST be
  generated with drizzle-kit and committed to the repository.
- There MUST NOT be a second persistence path. No raw driver handle, no other query builder,
  and no ad hoc SQL executed outside Drizzle.
- Drizzle is a query builder, not an ActiveRecord. State writes MUST remain explicit
  statements whose predicates and changed-row counts are visible at the call site, as
  Principle II requires.
- Connection pragmas MUST be applied at startup: `journal_mode = WAL`, `foreign_keys = ON`,
  and a non-zero `busy_timeout`.

SQLite is a single-file, single-writer engine. The application therefore runs as a single
process against a single database file. Multi-instance deployment, horizontal scaling, and
read replicas are out of scope, and the background job assumes it is the only scheduler
running. Changing that assumption requires a MAJOR amendment to this constitution, not a
workaround in application code.

## Development Workflow and Quality Gates

The integration suite MUST fail the build when zero tests run. A green result from an empty
or fully skipped suite is treated as a build failure, not a pass.

Code review MUST verify, for every change touching these areas:

- No order status transition logic outside the centralized state machine.
- No status write that omits the expected-state predicate, and no zero-change result mapped
  to anything other than 409.
- No unbounded UPDATE, no uncapped loop, and no write transaction spanning a whole tick.
- No `REAL` or `NUMERIC` affinity, and no float arithmetic, on a money path.
- No TEXT or REAL timestamp on an ordering column, and no millisecond-truncated cursor.
- No persistence access that bypasses Drizzle, and no schema change without a committed
  drizzle-kit migration.
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

**Version**: 2.0.0 | **Ratified**: 2026-09-05 | **Last Amended**: 2026-09-05
