---
description: 'Task list for Fix Scheduler Processing Loop'
---

# Tasks: Fix Scheduler Processing Loop

**Input**: Design documents from `/specs/005-fix-scheduler-loop/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/scheduler-tick.md](contracts/scheduler-tick.md),
[quickstart.md](quickstart.md)

**Tests**: Included and mandatory. FR-025 to FR-029 require it and Constitution Principle VI names a
bounded background tick as one of the claims that must carry an integration test. The defect being
fixed is invisible in every outcome the suite currently asserts — the same orders are promoted either
way — so the tests are the only thing that can see this feature at all.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves

## Path Conventions

Single project at the repository root: `src/`, `test/`. Paths follow the structure decision in
[plan.md](plan.md).

## A note on story independence

The three user stories here are less separable than usual, and pretending otherwise would produce a
misleading plan. US1 is the only behaviour change; US2 and US3 are guarantees that already hold and
that this change must not break. Their tasks are therefore mostly tests, and those tests are worth
writing precisely because US1 is the kind of edit that breaks them.

US1 is independently deliverable and is the MVP. US2 and US3 are independently *verifiable* — each can
be checked without the others — but neither ships a behaviour of its own.

---

## Phase 1: Setup

**Purpose**: Nothing to install. This phase exists to establish the measurement the whole feature is
judged by, before anything changes.

- [X] T001 Record the current claim counts as a baseline by running `npm test -- --testPathPatterns='promotion'` and noting the `iterations` value asserted in `test/integration/lifecycle/promotion.bounded.spec.ts`, `promotion.claim.spec.ts` and `promotion.lifecycle.spec.ts`, confirming they are 2, 5 and 3 as [research.md](research.md) R2 records
- [X] T002 Confirm the starting tree is green with `npm run check` and a full `npm test`, so any later failure is attributable to this feature rather than inherited

**Checkpoint**: The before-state is measured and recorded. No behaviour has changed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The result shape every story's assertions read. Blocking because all three stories assert
against `TickResult`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add a `TickStopReason` union type (`'drained' | 'guard' | 'failed'`) and a `stopReason` field to the `TickResult` interface in `src/scheduler/order-promotion.task.ts`, exporting the type so tests can reference it rather than restating the literals (FR-023, data-model.md)
- [X] T004 Set `stopReason: 'failed'` on the early return in the `catch` block of `runTick` in `src/scheduler/order-promotion.task.ts`, leaving `capReached: false` and the already-committed counts exactly as they are (FR-019, FR-023)
- [X] T005 Include `stopReason` in the `order.promotion.tick` record emitted by `runTick` in `src/scheduler/order-promotion.task.ts`, added alongside the existing fields rather than replacing any of them (FR-022, FR-023)

**Checkpoint**: The tick reports why it stopped. The loop still behaves exactly as before.

---

## Phase 3: User Story 1 - A run ends when the work does (Priority: P1) 🎯 MVP

**Goal**: A tick stops on the batch that proves the backlog is drained, instead of spending one more
write transaction confirming it.

**Independent Test**: seed a backlog smaller than one chunk, invoke one tick directly, and assert the
claim count is 1 rather than 2, with the promoted count unchanged.

### Tests for User Story 1

- [X] T006 [P] [US1] Create `test/integration/lifecycle/promotion.termination.spec.ts` asserting that a backlog smaller than one chunk costs exactly one claim, promotes every order, and reports `stopReason: 'drained'` with `capReached: false` (FR-004, FR-006, SC-002)
- [X] T007 [US1] Extend `test/integration/lifecycle/promotion.termination.spec.ts` with the empty-backlog case: exactly one claim, nothing promoted, `stopReason: 'drained'` — the floor that a tick cannot go below, since it cannot know the queue is empty without asking once (FR-006, SC-001)
- [X] T008 [US1] Extend `test/integration/lifecycle/promotion.termination.spec.ts` with the exact-chunk case: a backlog of exactly one chunk costs **two** claims, because a full batch is not evidence of an empty queue. This is the boundary that makes the comparison `claimed < chunkSize` rather than `<=`, and getting it wrong the other way strands a chunk per tick (FR-005, contracts/scheduler-tick.md)
- [X] T009 [US1] Extend `test/integration/lifecycle/promotion.termination.spec.ts` to walk the whole termination table in [contracts/scheduler-tick.md](contracts/scheduler-tick.md) as a single table-driven case, so a backlog shape nobody thought to name individually is still covered (FR-027)
- [X] T010 [US1] Assert in `test/integration/lifecycle/promotion.termination.spec.ts` that the claim count is read from the tick result directly rather than inferred from the promoted count, since the promoted count is identical before and after this change and cannot see the defect (FR-027)

### Implementation for User Story 1

- [X] T011 [US1] Replace the `if (claimed === 0) break;` exit in `runTick` in `src/scheduler/order-promotion.task.ts` with `if (claimed < chunkSize) break;`, setting `stopReason = 'drained'`, and **keep `while (iterations < maxIterations)` as the loop condition** so boundedness stays a property of the loop's shape (FR-002, FR-003, FR-004, research R3)
- [X] T012 [US1] Set `stopReason = 'guard'` on the path where the loop exits by its own condition in `src/scheduler/order-promotion.task.ts`, and leave `capReached` computed exactly as it is today (FR-009, research R5)
- [X] T013 [US1] Replace the comment above the loop in `src/scheduler/order-promotion.task.ts` so it records why a short batch is sufficient — one statement, one transaction, a single-writer engine, so nothing can interleave — with a pointer to research R1, since the previous reasoning was the opposite and a future reader will otherwise reinstate it

**Checkpoint**: The defect is fixed and measurable. User Story 1 is independently deliverable.

---

## Phase 4: User Story 2 - The limit still stops a runaway run (Priority: P2)

**Goal**: The cap remains a hard guard, and the loop cannot become unbounded.

**Independent Test**: seed a backlog far larger than chunk times cap, invoke one tick, and confirm the
claim count equals the cap exactly and the promoted count is unchanged from today.

### Tests for User Story 2

- [X] T014 [P] [US2] Extend `test/integration/lifecycle/promotion.termination.spec.ts` asserting a backlog larger than chunk times cap performs exactly the cap's claims, promotes exactly chunk times cap, and reports `capReached: true` with `stopReason: 'guard'` (FR-008, FR-011, SC-004)
- [X] T015 [P] [US2] Extend `test/integration/lifecycle/promotion.termination.spec.ts` with a cap configured to 1, asserting exactly one claim against a large backlog, so the guard is exercised at its smallest setting where an off-by-one would be invisible at the default (FR-007, edge case)
- [X] T016 [US2] Extend `test/integration/lifecycle/promotion.termination.spec.ts` with a backlog refilled before every claim, so no batch is ever short, asserting the tick still terminates at exactly the cap. This is the case that distinguishes a loop with a guard from a loop that merely happens to finish (FR-010, SC-005, SC-006)
- [X] T017 [US2] Assert in `test/integration/lifecycle/promotion.termination.spec.ts` that a backlog of exactly chunk times cap reports `stopReason: 'guard'` and `capReached: true` even though it is in fact drained, documenting in the test why that is correct rather than a defect (research R5, contracts/scheduler-tick.md)

### Implementation for User Story 2

- [X] T018 [US2] Verify by reading `src/scheduler/order-promotion.task.ts` that the cap is still the `while` condition and that no path can increment `iterations` without the condition being re-tested, then record that check in the loop's comment. There is no code to write here: the guarantee is preserved by the shape T011 deliberately did not change (FR-010, research R3)

**Checkpoint**: Boundedness is asserted directly rather than assumed.

---

## Phase 5: User Story 3 - Nothing else about order processing changed (Priority: P3)

**Goal**: Which orders are promoted, in what order, under what protections, and what is reported, are
all exactly as before.

**Independent Test**: run the complete pre-existing suite and confirm it passes with exactly the three
amended iteration counts and no other edit.

### Implementation for User Story 3

- [X] T019 [P] [US3] Amend the single expectation in `test/integration/lifecycle/promotion.bounded.spec.ts`, test "ends early when the backlog runs out": `expect(result.iterations).toBe(2)` becomes `toBe(1)`. Leave `promoted`, `capReached` and the pending count untouched, and update the two-line comment that explains the old count (FR-028)
- [X] T020 [P] [US3] Amend the single expectation in `test/integration/lifecycle/promotion.claim.spec.ts`, test "commits each chunk separately rather than holding one transaction": `expect(result.iterations).toBe(5)` becomes `toBe(4)`. Rewrite the comment above it, which currently states "FR-085 ends a tick on a zero-row claim, not on a short one: a short chunk is not evidence the backlog is empty" — the reasoning this feature reverses (FR-028)
- [X] T021 [P] [US3] Amend the single expectation in `test/integration/lifecycle/promotion.lifecycle.spec.ts`, test "records what each tick did": `iterations: 3` becomes `iterations: 2`. Rewrite the comment "100, then 50, then a zero-row claim that ends the tick" to describe the two claims that now happen (FR-028)
- [X] T022 [US3] Run the full suite and confirm **exactly** those three assertions needed changing. Treat a fourth as evidence of an unintended behaviour change and investigate it as a defect rather than adjusting it (FR-028, SC-008)
- [X] T023 [US3] Confirm no promotion count anywhere in the suite moved, by diffing the amended test files and checking that every changed line is an iteration count or a comment (FR-021, SC-007)
- [X] T024 [US3] Confirm the concurrency, ordering, atomicity, overlap, shutdown and failure suites pass untouched: `cancel-order.concurrency.spec.ts`, `promotion.claim.spec.ts` ordering cases, `scheduler.no-overlap.spec.ts`, `shutdown.drain.spec.ts` and `promotion.lifecycle.spec.ts` failure cases (FR-012 to FR-020, SC-007)

**Checkpoint**: All three stories complete. The change is proven to be a scheduler change only.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The evidence that the new assertions are load-bearing, and the record of why this
reverses a decision another specification made deliberately.

- [X] T025 Run the mutation sweep for this feature: restore `claimed === 0` in place of `claimed < chunkSize` and confirm the suite turns red; remove the cap from the `while` condition and confirm the suite turns red; leave `stopReason` unset on one path and confirm the suite turns red. Run it from the scratchpad so no commit can capture a mutated file (FR-029, SC-009)
- [X] T026 Confirm `npx drizzle-kit generate` reports no pending schema change, proving this feature added no persistence (SC-011)
- [X] T027 Run `npm run check` and confirm it exits 0, including the Spec 004 OpenAPI export gate, which must be unaffected because the scheduler has no HTTP surface
- [X] T028 [P] Record the Spec 005 mutation results in `test/integration/README.md`, in the same form Specs 002, 003 and 004 used, naming which suite caught each mutation (FR-029)
- [X] T029 [P] Add a Spec 005 row to the decision log in `README.md` recording that Spec 003 deliberately chose to stop only on a zero-row claim, that its stated reason was measured and found not to hold, and that the confirming claim was removed on the strength of that measurement (research R1)
- [X] T030 [P] Note in `test/integration/README.md` that the promoted count cannot see this defect, so the claim count is asserted directly — the same lesson Spec 004 recorded when a test asserted a document's prose instead of its behaviour
- [X] T031 Walk every scenario in [quickstart.md](quickstart.md) against a running service and a throwaway database, and correct the document where reality differs
- [X] T032 Mark every task in this file `[X]` only after its verification has actually run, not after its code was written

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup; blocks every user story
- **User Story 1 (Phase 3)**: depends on Foundational
- **User Story 2 (Phase 4)**: depends on Foundational, and its assertions are only meaningful once US1 has changed the loop
- **User Story 3 (Phase 5)**: depends on US1, since the three amended counts are US1's direct consequence
- **Polish (Phase 6)**: depends on everything

### Within Each User Story

Tests are written before the implementation they cover and are expected to fail first. That ordering
matters more than usual here: a test written after the loop change would describe whatever claim count
the new loop produced, which is exactly the assertion this feature cannot afford to get wrong.

### Sequential Constraints Worth Naming

- T006 to T010 and T014 to T017 all edit `test/integration/lifecycle/promotion.termination.spec.ts` and must not run in parallel with each other
- T003 to T005 and T011 to T013 all edit `src/scheduler/order-promotion.task.ts` and must not run in parallel with each other
- T019, T020 and T021 touch three different files and may run together
- T025 must run alone. The sweep mutates files in place and restores them at the end, so a commit taken mid-sweep captures a mutated file. That happened once in Spec 003

### Parallel Opportunities

- T019, T020 and T021 in User Story 3
- T028, T029 and T030 in Polish
- T006 and T014 are marked `[P]` only as the first task to touch the termination suite in their phase; once the file exists the rest of that phase is sequential

---

## Implementation Strategy

### MVP First

1. Phase 1 and Phase 2.
2. Phase 3, User Story 1.
3. **Stop and validate**: a short backlog costs one claim, an empty backlog costs one, an exact chunk
   costs two. This alone is the feature.

### Incremental Delivery

1. Setup and Foundational: the tick reports why it stopped, behaviour unchanged.
2. Add US1: the defect is fixed. Deliverable.
3. Add US2: boundedness is proven rather than assumed. Deliverable.
4. Add US3: the rest of the system is proven untouched.

### What "Done" Means Here

Not that the suite is green — it is green today, with the defect in place. The gate is that T006 to
T010 and T014 to T017 pass, that exactly three pre-existing assertions changed and every one of them
is an iteration count, that no promotion count moved anywhere, and that T025's sweep shows the new
assertions are load-bearing. A change that reduces the claim count without those is indistinguishable
from a change that quietly stopped doing some of the work.

---

## Notes

- Every task names its requirement, so a reviewer can go from a line of the specification to the task
  that discharged it and the test that proves it.
- `[P]` means a different file and no dependency on incomplete work.
- Do not commit while T025 is running.
- This feature reverses a decision Spec 003 made deliberately and documented. T013, T020, T021 and
  T029 exist so the reversal is visible to the next reader rather than looking like drift.

---

## Phase 7: Convergence

**Purpose**: Close the gap between the artifacts and the code, found by assessing the
implementation against spec, plan, contract and data model after implementation.

All three findings sit on the same untested area: the failure path. The drained and guard
paths are covered thoroughly; `stopReason: 'failed'` was written from the specification and
then never exercised, which is the exact failure mode FR-029 exists to prevent.

- [X] T033 Assert the `failed` stop reason against a real provoked failure in `test/integration/lifecycle/promotion.lifecycle.spec.ts` or `promotion.termination.spec.ts`, and add it to the mutation sweep, since replacing it with `'drained'` currently leaves the suite green per FR-023, SC-010 and FR-029 (partial). Done: `promotion.lifecycle.spec.ts`'s "keeps committed chunks and ends the tick when a chunk fails" now asserts `result.iterations === 1`, `result.stopReason === 'failed'` and `result.capReached === false`. Verified load-bearing by mutation: reverting T035's fix turns this assertion red (`Expected: 1, Received: 0`); restored afterward and reconfirmed 39/39 green.
- [X] T034 Decide and record whether `stopReason` must reach a structured record on the failure path per FR-023 (contradicts). The catch block returns early without emitting `order.promotion.tick`, so the value is observable only on the returned `TickResult`; either add it to the `order.promotion.failed` record or state in `contracts/scheduler-tick.md` that the record name carries the reason on that path. Done: recorded in `contracts/scheduler-tick.md`'s Log record section — the `message` field (`order.promotion.tick` vs `order.promotion.failed`, mutually exclusive per tick) is the distinguishing signal FR-023 requires; `stopReason` stays on `TickResult` for the direct caller and is deliberately not duplicated onto the failure log record.
- [X] T035 Reconcile the failure-path iteration count with its two documentation sources per data-model.md invariant and contracts/scheduler-tick.md termination table (contradicts). `iterations += 1` runs after `claimChunk`, so a throw on the first claim returns `iterations: 0`, contradicting "iterations >= 1 always" and the table's claim of `k` claims for a throw on batch `k`. Either count the attempt or correct both documents, and assert whichever is chosen. Done: `iterations += 1` now runs before `claimChunk()` in `order-promotion.task.ts`, so a throw on batch `k` reports `iterations: k`, matching both documents. No document edit needed — the code now matches what was already written.
