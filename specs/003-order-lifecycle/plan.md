# Implementation Plan: Order Lifecycle and Processing

**Branch**: `003-order-lifecycle` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-order-lifecycle/spec.md`

## Summary

Add the behaviour that Spec 002's data model was built to carry: creating orders, reading one,
paging many, cancelling one, and promoting pending orders in the background. Spec 002 recorded three
consumer obligations in its persistence contract, and this feature discharges all three. O1, an order
and its lines written in one transaction, lands in the creation service. O2, a total derived and made
to fail loudly rather than round, lands in one shared derivation function used by every read path. O3,
deciding which transitions are legal, lands in the state machine module that Constitution Principle I
demands.

The technical approach was settled by what the installed toolchain can express, verified in Phase 0
rather than assumed, and two of those verifications changed the design. The bounded background claim
that Principle III mandates as a literal SQL shape turns out to be expressible through Drizzle's
`inArray` against a select subquery, emitting that shape term for term, so this feature records **no**
constitutional deviation and does not inherit Spec 002's. The keyset cursor uses a row-value
comparison rather than the equivalent OR form, because measurement showed the OR form degrades to
walking an entire status once a status filter is applied.

Request validation is built on zod, already present for configuration, applied through a small pipe.
That choice carries a trap Phase 0 caught: a plain zod object schema silently discards unknown keys
and reports success, which would let a caller believe it had set a price it did not set. Every request
contract uses a strict object schema, and a test asserts the rejection.

## Technical Context

**Language/Version**: TypeScript 5.9.3 targeting Node.js 22 or newer, as declared in `package.json`
engines. Development and verification here ran on Node 24.19.0. Module format is unchanged: CommonJS
output against ESM-only NestJS packages, coexisting through Node's `require(esm)`.

**Primary Dependencies**: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` 12 for the HTTP
surface and `@nestjs/schedule` 12 for the tick; `drizzle-orm` 0.45.2 over `better-sqlite3` 13.0.3 for
every persistence operation; `zod` 4.5.4 for request validation, which is the same library that
already validates configuration. **No new runtime dependency is added.** `class-validator` and
`class-transformer` are deliberately not installed, for the reason recorded in research R1.

**Storage**: The single SQLite file Spec 001 opens, with `journal_mode = WAL`, `foreign_keys = ON`,
and `busy_timeout = 5000`. This feature adds one table, `idempotency_records`, through a generated and
committed migration. It adds no column to and no index on the tables Spec 002 owns.

**Testing**: Jest 30 with ts-jest, `maxWorkers: 1`, `passWithNoTests: false`, launched as
`node --experimental-vm-modules node_modules/jest/bin/jest.js`. Endpoints are exercised through
`supertest` against the real application graph built by the existing `createTestApp` harness, never
against a mocked repository.

**Target Platform**: A single Node process against a single database file, per the constitution's
scope constraints. The background job assumes it is the only scheduler running.

**Project Type**: Web service. This feature contributes the HTTP surface, the domain services, the
state machine, and the scheduled job.

**Performance Goals**: Both listing queries must be index-served at 10,000 orders (SC-003), asserted
against the database's own execution plan. A single tick's blocking work is bounded by chunk size
times iteration cap, 1,000 orders at the defaults (SC-012). No request latency target is set; the
constitution's concern is blocking the event loop, not response time.

**Constraints**: One writer, so every race is settled by a conditional predicate rather than by a
lock. Money is integers in `[0, 9007199254740991]`, and the one value no column constraint can bound
is the derived order total, which must therefore fail loudly. Timestamps are integer microseconds and
must not be exposed in any truncating form, or a consumer will build a cursor from a truncated value.
Statuses are exactly the three Spec 002 defined; adding one requires a Spec 002 migration and is out
of scope.

**Scale/Scope**: One new table, five endpoints, one state machine, one scheduled job. Largest test
fixture is 10,000 orders for the paging and plan assertions and 5,000 for the backlog assertion. As
Spec 002 recorded, these are fixture sizes and not capacity claims.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.1.0**.

| Principle | Verdict | Basis |
| :--- | :--- | :--- |
| I. Centralized State Machine | **PASS** | FR-058 puts the whole transition graph in one module; FR-061 makes that module the rejecting authority; FR-064 forbids any endpoint that accepts an arbitrary target status, which is the loophole that would otherwise reintroduce inline logic. FR-063 asserts the graph exhaustively over every ordered status pair, so an added status cannot skip declaring its edges |
| II. Lock-Free Atomic Transitions | **PASS** | FR-065 mandates the conditional shape, FR-066 forbids the read-then-write guard, FR-067 and FR-068 take the decision from the changed-row count and map zero to 409 only. Phase 0 R3 confirmed the count is 1 on match and 0 on miss through Drizzle. See the note below on FR-069 |
| III. Bounded Background Processing | **PASS** | FR-082 requires the constitution's exact claim shape, which Phase 0 R2 proved Drizzle emits verbatim. FR-084 enforces the iteration cap, FR-086 keeps each chunk in its own transaction, FR-087 makes the cap observable by measuring what one tick actually promotes against a larger backlog |
| IV. Exact-Integer Money and Immutable History | **PASS** | FR-008 keeps money integral on the wire, FR-018 captures the price from the catalog so no caller supplies one, FR-025 and FR-042a make an inexact total a loud failure on write and on read alike. FR-077 states that cancellation deletes nothing, and this feature introduces no deletion path against any historical row |
| V. Two-Phase Keyset Reads | **PASS** | FR-045 requires the two queries and forbids join-then-limit, FR-048 requires a totally ordered cursor, FR-055 asserts both plans against a large table. FR-009 extends the principle to the wire by refusing to expose any truncating rendering of an ordering timestamp, which is where a consumer would otherwise get a millisecond-precision value to build a cursor from |
| VI. Integration-Proven Verification | **PASS** | FR-101 runs everything against a real database through the real application graph. FR-102 registers the new table in the harness's isolation lists, in the phase Phase 0 R6 proved it must occupy. FR-103 states honestly how a race is proven on a single-writer engine. FR-107 requires that removing any guarantee turns the suite red |
| Scope: single currency | **PASS** | No currency field is introduced on the wire or in storage |
| Scope: Drizzle as sole persistence path | **PASS** | Every application read and write goes through Drizzle, including the bounded claim (R2). Test fixtures and query-plan assertions use prepared statements directly, which is the same position Spec 002 took: that is fixture loading and planner inspection, not an application persistence path |
| Workflow: build fails on zero tests | **PASS** | `passWithNoTests: false` unchanged |

**Gate result: PASS, with no recorded deviation.** The Complexity Tracking section below is empty and
is retained only to say so explicitly.

Two things are worth stating rather than leaving a reviewer to reconstruct them:

**FR-069 is not the read-then-write Principle II forbids.** The principle bans reading current state
in order to *decide* a transition. FR-069 reads only after the conditional update has already been
issued and has already reported zero changed rows, and only to classify that failure as 404 or 409.
The transition decision was made by the database. A read in that position cannot cause a lost update
because there is no subsequent write.

**The idempotency fast-path read is an optimisation, not the guarantee.** The creation path reads the
key table before attempting a write, because the common repeat is a client retry rather than a race.
FR-034 requires the guarantee to come from a database uniqueness constraint, and it does: a request
that passes the read and then loses the race still fails on the constraint, which is caught by error
code (R7) and turned into a replay. Removing the read would change performance and nothing else.

Re-evaluated after Phase 1 design: unchanged. The design introduced one table, whose only constraint
of consequence is the uniqueness FR-034 already required, and one contract document stating the HTTP
surface in the same terms the principles use.

## Project Structure

### Documentation (this feature)

```text
specs/003-order-lifecycle/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── http-api.md      # Phase 1 output: the endpoint contract
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/
├── orders/
│   ├── orders.module.ts             # wires controller, services, job
│   ├── orders.controller.ts         # create, get, list, cancel
│   ├── orders.service.ts            # creation, retrieval, listing
│   ├── order-state-machine.ts       # Principle I: the only transition authority
│   ├── order-transitions.ts         # Principle II: the conditional update, shared by request and job
│   ├── order-total.ts               # contract O2: the one place a total is derived
│   ├── order-cursor.ts              # Principle V: opaque cursor encode/decode
│   ├── idempotency.service.ts       # key lookup, fingerprint, replay
│   ├── order.schemas.ts             # zod request contracts (strict objects)
│   └── order.view.ts                # storage rows -> response representation
├── http/
│   ├── zod-validation.pipe.ts       # zod applied to body and query
│   ├── correlation.middleware.ts    # FR-007
│   └── http-exception.filter.ts     # FR-004, FR-005, FR-006
├── scheduler/
│   ├── order-promotion.task.ts      # replaces heartbeat.task.ts
│   ├── overlap-guard.ts             # unchanged from Spec 001
│   └── scheduler.module.ts          # registers the promotion task
├── database/
│   ├── schema/
│   │   ├── idempotency-records.ts   # new table
│   │   └── index.ts                 # extended: three ordered isolation lists
│   └── seed.ts                      # FR-017a: populates the placeholder dependencies
├── config/config.schema.ts          # extended: chunk size, iteration cap
└── app.module.ts                    # extended: imports OrdersModule

drizzle/
└── 0003_idempotency_records.sql     # generated, committed

test/
├── integration/orders/              # Spec 002's 12 files, unchanged
├── integration/lifecycle/           # this feature's suites
└── support/order-fixtures.ts        # extended: HTTP-level helpers
```

**Structure Decision**: A feature folder for the domain (`src/orders/`) alongside a small shared
folder for cross-cutting HTTP concerns (`src/http/`), matching the existing shape of the repository,
which already groups by concern rather than by layer (`config/`, `database/`, `health/`, `logging/`,
`scheduler/`). The state machine, the conditional-update helper, and the total derivation are separate
files rather than methods on the service, because each is a named constitutional guarantee and each
needs to be individually removable in the mutation check SC-010 requires.

`heartbeat.task.ts` is deleted rather than left in place, per FR-081, and the two Spec 001 tests that
named it are rewritten against the promotion job rather than dropped, per research R9.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. This section is intentionally empty.

Spec 002 recorded one deviation, that trigger DDL cannot live in a Drizzle schema module and therefore
ships in a hand-written migration. That deviation belongs to Spec 002 and is not inherited here: this
feature adds no trigger, and Phase 0 R2 established that the one SQL shape the constitution mandates
literally is expressible through Drizzle without falling back to raw SQL.
