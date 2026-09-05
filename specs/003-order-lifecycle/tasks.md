---

description: "Task list for Order Lifecycle and Processing"
---

# Tasks: Order Lifecycle and Processing

**Input**: Design documents from `/specs/003-order-lifecycle/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/http-api.md](contracts/http-api.md)

**Tests**: Required, not optional. Constitution Principle VI makes an integration test against a real
database the only accepted evidence that a guarantee holds, and the specification asks explicitly for
happy paths, isolation and failure paths, and teardown expectations. Test tasks are written before the
implementation they cover, and each must fail before that implementation exists.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel. Different file, and no dependency on an unfinished task.
- **[Story]**: Which user story the task serves.
- Every task names the exact file it changes.

---

## Phase 1: Setup

**Purpose**: The one new table, the configuration it needs, and the test-isolation change it forces.

- [ ] T001 Add `ORDER_PROMOTION_CHUNK_SIZE` (default 100) and `ORDER_PROMOTION_MAX_ITERATIONS` (default 10) to the zod schema in `src/config/config.schema.ts`, reusing the existing `positiveInt` helper so zero and negative values stop the process at startup (FR-083, FR-084)
- [ ] T002 [P] Document both new settings, with their defaults and their combined meaning as a per-tick blocking budget, in `.env.example`
- [ ] T003 [P] Create the `idempotency_records` table module in `src/database/schema/idempotency-records.ts`: unique `idempotency_key`, `request_fingerprint`, `order_id` foreign key to `orders` with `ON DELETE RESTRICT`, and `created_at_us` with the same integer-and-positive check the other timestamp columns use (FR-031, FR-034, FR-035)
- [ ] T004 Extend `src/database/schema/index.ts` to re-export the new table and to replace the two isolation lists with three ordered ones, `PRE_REBUILD_TABLE_NAMES`, `REBUILT_TABLE_NAMES`, `DELETABLE_TABLE_NAMES`, each carrying the reason for its position (FR-102, research R6). Depends on T003
- [ ] T005 Generate the migration with `npm run db:generate` and commit `drizzle/0003_*.sql`, checking that the unique constraint and the timestamp check appear as literal SQL rather than bound parameters, which is the failure mode Spec 002 hit in its R9. Depends on T003, T004
- [ ] T006 Rewrite the `beforeEach` in `test/setup/per-test.ts` as three ordered phases: delete `PRE_REBUILD_TABLE_NAMES`, rebuild `REBUILT_TABLE_NAMES`, delete `DELETABLE_TABLE_NAMES`. Depends on T004
- [ ] T007 Apply the migration to `./data/oms.db` with `npm run db:migrate` and confirm the new table and its index are present. Depends on T005

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The cross-cutting HTTP concerns and the three constitutional authorities. Every user
story depends on this phase, and the state machine belongs here rather than in a story because
Principle I makes it a single authority for the whole system, not a component of one endpoint.

**⚠️ No user story work can begin until this phase is complete.**

- [ ] T008 [P] Implement the correlation identifier middleware in `src/http/correlation.middleware.ts`: accept a well-formed `X-Correlation-Id`, generate one with `crypto.randomUUID` otherwise, attach it to the request and echo it on the response (FR-007, research R10)
- [ ] T009 [P] Define the error codes and the error body shape in `src/http/api-error.ts`, including the typed exception classes each endpoint throws (FR-004)
- [ ] T010 Implement the global exception filter in `src/http/http-exception.filter.ts`: map every thrown error to the single body shape with its correlation identifier, and ensure no stack trace, driver message, SQL fragment, or path reaches a response (FR-004, FR-005, FR-006). Depends on T009
- [ ] T011 [P] Implement the zod validation pipe in `src/http/zod-validation.pipe.ts`, turning a zod failure into per-field `details` on the error body (FR-002, FR-003)
- [ ] T012 [P] Implement the positive-integer route parameter pipe in `src/http/positive-int.pipe.ts`, so a non-numeric identifier is a malformed request rather than a missing resource (FR-039)
- [ ] T013 [P] Implement the single total derivation in `src/orders/order-total.ts`, summing stored line totals and throwing when the result is not exactly representable. This is the only place in the system that sums money (FR-024, FR-025, FR-042a, contract obligation O2)
- [ ] T014 [P] Implement the transition graph in `src/orders/order-state-machine.ts`: `pending → {processing, cancelled}` and nothing else, plus the inverse lookup returning the source statuses that permit a given target (FR-058 to FR-062, contract obligation O3)
- [ ] T015 Implement the conditional update helper in `src/orders/order-transitions.ts`: one statement naming the identity and the permitted source statuses, outcome taken from the changed-row count, and the post-failure classifying read that distinguishes 404 from 409 (FR-065 to FR-071). Depends on T014
- [ ] T016 [P] Implement the storage-row to response mapper in `src/orders/order.view.ts`, exposing microsecond integers and no truncating rendering of any ordering timestamp (FR-009, FR-010)
- [ ] T017 Create the module wiring in `src/orders/orders.module.ts`. Depends on T013, T015, T016
- [ ] T018 Register `OrdersModule` in `src/app.module.ts`, and the correlation middleware and exception filter in `src/main.ts` and in the test harness `test/setup/test-app.ts` so both graphs are identical. Depends on T008, T010, T017
- [ ] T019 [P] Add HTTP-level helpers to `test/support/http-fixtures.ts`: a supertest agent over the existing `createTestApp` harness, plus builders for a valid creation body
- [ ] T020 [P] Write the exhaustive state machine test in `test/integration/lifecycle/state-machine.spec.ts`, asserting the verdict for all nine ordered status pairs so a status added without declared edges fails (FR-063). Depends on T014
- [ ] T021 [P] Write the total derivation test in `test/integration/lifecycle/order-total.spec.ts`, covering the exact boundary and the overflow that must throw rather than round (FR-025, FR-042a). Depends on T013
- [ ] T022 [P] Write the HTTP envelope test in `test/integration/lifecycle/http-contract.spec.ts`: one error shape, a correlation identifier on success and failure, and no leaked internals (FR-004 to FR-007). Depends on T018

**Checkpoint**: The authorities exist and are proven. Endpoint work can begin.

---

## Phase 3: User Story 1 - Place an Order (Priority: P1) 🎯 MVP

**Goal**: An order can be placed, is stored atomically with the catalog price captured, and a retried
request carrying an idempotency key never produces a second one.

**Independent Test**: Submit a well-formed order and confirm the stored order carries the catalog
price rather than any price the caller supplied, with a total equal to the sum of the stored line
totals; then submit it again with the same key and confirm one order exists.

### Tests for User Story 1

- [ ] T023 [P] [US1] Creation happy path in `test/integration/lifecycle/create-order.spec.ts`: 201, `Location`, status `pending`, equal timestamps, catalog-sourced prices, exact total, duplicate products on separate lines (FR-011, FR-018 to FR-026)
- [ ] T024 [P] [US1] Creation rejections in `test/integration/lifecycle/create-order.validation.spec.ts`: empty lines, 101 lines, quantity 0, quantity 1.5, quantity as a string, unknown customer, unknown product, and a body carrying `unitPriceMinor`, `status`, or `id`. The last group is the one that catches a non-strict schema, which research R1 measured as silently succeeding (FR-003, FR-012 to FR-017)
- [ ] T025 [P] [US1] Atomicity and price capture in `test/integration/lifecycle/create-order.atomicity.spec.ts`: a request with one unknown product leaves zero orders and zero lines; changing a catalog price afterwards does not move a stored line; a total that would exceed the ceiling aborts and stores nothing (FR-017, FR-020, FR-025, FR-027)
- [ ] T026 [P] [US1] Idempotency in `test/integration/lifecycle/idempotency.spec.ts`: replay returns 200 with the original order and a replay marker, a differing body under the same key returns 409, a malformed key is rejected, no key means no protection, and a simulated race resolves through the unique constraint rather than the read (FR-028 to FR-034, research R7, R8)

### Implementation for User Story 1

- [ ] T027 [US1] Define the creation request contract in `src/orders/order.schemas.ts` with `z.strictObject` at both levels and the bounds from FR-014 and FR-015
- [ ] T028 [US1] Implement the idempotency key lookup, canonical-body fingerprint, and unique-violation classification in `src/orders/idempotency.service.ts`, branching on the driver's `SQLITE_CONSTRAINT_UNIQUE` code rather than on its message (FR-030a, FR-034, research R7)
- [ ] T029 [US1] Implement creation in `src/orders/orders.service.ts`: resolve customer and products, capture description and price, insert order and lines in one transaction, derive the total inside that transaction and abort when it is inexact. Depends on T027
- [ ] T030 [US1] Write the idempotency record inside that same transaction in `src/orders/orders.service.ts`, so a key is never recorded for an order that was not created (FR-031). Depends on T028, T029
- [ ] T031 [US1] Add the `POST /orders` route in `src/orders/orders.controller.ts`, returning 201 with `Location` or 200 with the replay marker. Depends on T029, T030
- [ ] T032 [US1] Emit the creation log record with correlation identifier, order identifier, line count, and total in `src/orders/orders.service.ts` (FR-095). Depends on T029
- [ ] T033 [P] [US1] Implement the seeding command in `src/database/seed.ts`, re-runnable, printing the identifiers it creates, and add the `db:seed` script to `package.json` (FR-017a)

**Checkpoint**: Orders can be placed. This is the MVP.

---

## Phase 4: User Story 2 - Retrieve an Order (Priority: P2)

**Goal**: A stored order reads back complete, with a total derived rather than stored.

**Independent Test**: Place an order, read it by identifier, confirm every field matches and the
total is the exact integer sum of the lines.

### Tests for User Story 2

- [ ] T034 [P] [US2] Retrieval in `test/integration/lifecycle/get-order.spec.ts`: found returns order, lines in stable ascending order, and derived total; unknown identifier returns 404; a non-numeric identifier returns 400 and not 404; the line array is never empty (FR-038 to FR-043)

### Implementation for User Story 2

- [ ] T035 [US2] Implement single-order retrieval in `src/orders/orders.service.ts` as one order query plus one line query, deriving the total through `order-total.ts`
- [ ] T036 [US2] Add the `GET /orders/:id` route in `src/orders/orders.controller.ts` using the positive-integer pipe from T012. Depends on T035

**Checkpoint**: Placed orders are verifiable from outside the system.

---

## Phase 5: User Story 3 - List Orders (Priority: P3)

**Goal**: Orders page newest first with bounded work per request, and every order appears exactly
once across a full traversal.

**Independent Test**: Seed 10,000 orders, page all of them, confirm no duplicates and no omissions
including across shared timestamps, and confirm both queries are index-served.

### Tests for User Story 3

- [ ] T037 [P] [US3] Cursor codec in `test/integration/lifecycle/order-cursor.spec.ts`: round-trips the full microsecond value and the tiebreaker, and rejects a truncated, corrupted, non-base64, or structurally wrong token rather than treating it as absent (FR-048 to FR-050)
- [ ] T038 [P] [US3] Pagination completeness in `test/integration/lifecycle/list-orders.pagination.spec.ts`: 10,000 orders paged at several page sizes with zero duplicates and zero omissions, contiguous ordering across shared timestamps, cursor idempotence, and stability when an order is created mid-traversal (FR-052, FR-053, FR-057)
- [ ] T039 [P] [US3] Query plans in `test/integration/lifecycle/list-orders.plans.spec.ts`: both listing queries index-served at 10,000 orders, filtered **and** unfiltered. The filtered case is the one that matters, because research R4 measured the OR form degrading to a walk of the whole status there (FR-054, FR-055)
- [ ] T040 [P] [US3] Listing rejections in `test/integration/lifecycle/list-orders.validation.spec.ts`: `limit=0`, `limit=101`, `offset=10`, an unknown query parameter, an unknown status value, and a malformed cursor (FR-046, FR-047, FR-050, FR-056)

### Implementation for User Story 3

- [ ] T041 [US3] Implement the opaque cursor codec in `src/orders/order-cursor.ts`, base64url over the microsecond value and identifier, decoded defensively and never through a date type
- [ ] T042 [US3] Add the listing query contract to `src/orders/order.schemas.ts`, rejecting `offset`, `page`, and any unrecognised parameter. Depends on T027
- [ ] T043 [US3] Implement the two-phase listing in `src/orders/orders.service.ts` with the row-value keyset predicate and the `order_id IN (...)` line fetch, never a join followed by a limit. Depends on T041, T042
- [ ] T044 [US3] Add the `GET /orders` route in `src/orders/orders.controller.ts` returning orders, `nextCursor`, and the effective limit. Depends on T043

**Checkpoint**: Reading scales with page size rather than table size.

---

## Phase 6: User Story 4 - Cancel an Order and Refuse Illegal Transitions (Priority: P4)

**Goal**: A pending order cancels; a processing or already-cancelled one is refused; two simultaneous
cancellations produce exactly one success.

**Independent Test**: Cancel a pending order, then cancel it again, then cancel a processing one, then
cancel a missing one, and confirm 200, 409, 409, 404 in that order.

### Tests for User Story 4

- [ ] T045 [P] [US4] Cancellation outcomes in `test/integration/lifecycle/cancel-order.spec.ts`: pending cancels with an advanced `updatedAtUs` and an unchanged `createdAtUs`; processing and already-cancelled both return 409 naming the current status; a missing identifier returns 404 and not 409; line items are unchanged afterwards (FR-072 to FR-077)
- [ ] T046 [P] [US4] Races in `test/integration/lifecycle/cancel-order.concurrency.spec.ts`: two cancellations against one pending order in both interleavings yield exactly one change and one conflict; a cancellation interleaved with a promotion leaves exactly one of the two statuses (FR-078, FR-079, FR-103)

### Implementation for User Story 4

- [ ] T047 [US4] Implement cancellation in `src/orders/orders.service.ts` through `order-transitions.ts`, taking the permitted source statuses from the state machine rather than restating them. Depends on T015
- [ ] T048 [US4] Add the `POST /orders/:id/cancel` route in `src/orders/orders.controller.ts`, accepting no body. Depends on T047
- [ ] T049 [US4] Emit the transition log record with order identifier, source, target, and outcome in `src/orders/order-transitions.ts`, so request-path and background transitions produce the same record (FR-096). Depends on T015

**Checkpoint**: The state machine has a real refusal, and a race has a deterministic winner.

---

## Phase 7: User Story 5 - Promote Pending Orders in the Background (Priority: P5)

**Goal**: A tick promotes pending orders oldest first in bounded chunks and stops at its iteration
cap, leaving the remainder for the next tick.

**Independent Test**: Seed a backlog larger than chunk times cap, invoke one tick directly, and
confirm exactly chunk times cap orders moved and the rest did not.

### Tests for User Story 5

- [ ] T050 [P] [US5] Boundedness in `test/integration/lifecycle/promotion.bounded.spec.ts`: 5,000 pending orders yield exactly 1,000 promoted in one tick at the defaults; a backlog under one chunk ends the tick early; an empty backlog performs one claim and ends without error (FR-084, FR-085, FR-087)
- [ ] T051 [P] [US5] Claim semantics in `test/integration/lifecycle/promotion.claim.spec.ts`: oldest first, cancelled orders never promoted, each chunk in its own transaction, the changed-row count uninflated by the touch trigger at 100 rows, and the claim index-served (FR-082, FR-086, FR-089, FR-090, research R2, R3)
- [ ] T052 [P] [US5] Tick lifecycle in `test/integration/lifecycle/promotion.lifecycle.spec.ts`: overlapping ticks skipped and recorded, no tick after shutdown begins, a mid-tick failure leaving committed chunks committed, and the per-tick log record carrying iterations, promoted count, cap-reached flag, and duration (FR-091, FR-092, FR-094, FR-097)

### Implementation for User Story 5

- [ ] T053 [US5] Implement the promotion task in `src/scheduler/order-promotion.task.ts`: the constitution's bounded claim built with Drizzle's `inArray` over a select subquery, one transaction per chunk, the iteration cap, the early exit on a zero-row claim, and the target status taken from the state machine. Depends on T014, T015
- [ ] T054 [US5] Register the promotion task and drop the heartbeat from `src/scheduler/scheduler.module.ts`, keeping the `scheduler.registered` record and its `intervalMs` field so Spec 001's configurable-interval test still passes unchanged (FR-081, research R9). Depends on T053
- [ ] T055 [US5] Delete `src/scheduler/heartbeat.task.ts`. Depends on T054
- [ ] T056 [US5] Rewrite `test/integration/scheduler.fires.spec.ts` against the promotion task, preserving Spec 001's coverage that recurring work registers and fires rather than dropping it. Depends on T054
- [ ] T057 [US5] Confirm `test/integration/scheduler.configurable.spec.ts` and `test/integration/scheduler.no-overlap.spec.ts` still pass untouched, and record in the file header why they needed no change. Depends on T054

**Checkpoint**: All five stories functional.

---

## Phase 8: Polish and Cross-Cutting Verification

- [ ] T058 [P] Append the decision-log rows for this feature to `README.md`: idempotency on create, the legal transition set, the row-value cursor, and the tick budget
- [ ] T059 [P] Document the third cleanup phase and why its order is not optional in `test/integration/README.md`
- [ ] T060 [P] Update `.env.example` commentary if T001's defaults changed during implementation
- [ ] T061 Run `npm run check` and fix every formatting, lint, and type error until it exits 0
- [ ] T062 Run `npm test` twice consecutively and confirm identical results, per SC-009. Depends on T061
- [ ] T063 Confirm a zero-test run still exits non-zero by running `npm test -- --testPathPatterns nonexistent`, per FR-106
- [ ] T064 Confirm `npm run db:generate` reports no pending schema changes, proving the committed migration matches the schema modules
- [ ] T065 Run the mutation check for SC-010 from a script in the scratchpad that mutates `src/` and `drizzle/` in place and restores them, against this feature's guarantees: strict request schemas, the expected-status predicate, the outer status predicate in the claim, the iteration cap, the exactness check, the cursor tiebreaker, and the idempotency unique constraint. Each removal must turn the suite red. Depends on T062
- [ ] T066 Walk every scenario in `quickstart.md` end to end against a fresh database, including `npm run db:seed` and the curl calls, and correct the document wherever reality differs. Depends on T061

---

## Dependencies and Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no dependencies. T003 blocks T004, which blocks T005 and T006.
- **Foundational (Phase 2)** depends on Setup and blocks every user story.
- **User stories (Phases 3 to 7)** all depend on Foundational.
- **Polish (Phase 8)** depends on every story that is being delivered.

### Story dependencies

- **US1** depends only on Foundational.
- **US2** depends only on Foundational. It shares `orders.service.ts` and `orders.controller.ts` with US1, so it is sequenced after US1 rather than run beside it.
- **US3** depends only on Foundational, and shares the same two files.
- **US4** depends only on Foundational, through `order-transitions.ts` and the state machine.
- **US5** depends only on Foundational. Its concurrency test in T046 exercises the same race from the cancellation side, so running US4 first makes that test cheaper to write, but neither story needs the other's code.

### Serialised files

These files are touched by several tasks and those tasks are therefore never marked `[P]`, whatever
phase they sit in:

| File | Tasks |
| :--- | :--- |
| `src/orders/orders.service.ts` | T029, T030, T032, T035, T043, T047 |
| `src/orders/orders.controller.ts` | T031, T036, T044, T048 |
| `src/orders/order.schemas.ts` | T027, T042 |
| `src/orders/order-transitions.ts` | T015, T049 |
| `src/database/schema/index.ts` | T004 |
| `src/scheduler/scheduler.module.ts` | T054 |

### Parallel opportunities

- Phase 1: T002 and T003 together.
- Phase 2: T008, T009, T011, T012, T013, T014, T016, T019 together; then T020, T021, T022 together.
- Every story's test tasks are parallel with each other, since each writes its own file.
- Implementation tasks within a story are mostly serialised by the two shared files above.

---

## Implementation Strategy

### MVP first

1. Phase 1, then Phase 2 in full. Neither can be partially skipped: the cleanup ordering in T006 and
   the state machine in T014 are prerequisites for the suite even passing.
2. Phase 3 (US1). Stop and validate: an order can be placed, priced from the catalog, and not
   duplicated by a retry.

### Incremental delivery

Each subsequent story adds one endpoint or one job and its tests, and leaves the previous ones
working. US2 makes US1 verifiable from outside, US3 makes the collection readable, US4 adds the only
caller-driven transition, and US5 adds the only automatic one.

### Notes

- Every test task must fail before its implementation task is done. A test that passes when written is
  testing something other than what it claims.
- Commit after each task or logical group.
- T065 is not optional polish. SC-010 makes it the evidence that the rest of the suite is load-bearing,
  and Spec 002 established the practice.
