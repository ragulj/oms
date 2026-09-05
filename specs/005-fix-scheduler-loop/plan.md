# Implementation Plan: Fix Scheduler Processing Loop

**Branch**: `005-fix-scheduler-loop` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-fix-scheduler-loop/spec.md`

## Summary

Stop the background promotion tick one claim earlier. A batch that comes back shorter than the chunk
size proves the backlog is drained, so the tick ends on it rather than spending another write
transaction discovering the same thing. The iteration cap stays exactly where it is and keeps doing
exactly what it does.

The change is four lines of loop and one added field. Phase 0 spent its effort on whether those four
lines are *safe*, because the requested edit — demote the cap from loop condition to guard — is also
the edit that turns a bounded loop into an unbounded one if it is made literally.

Two Phase 0 findings changed the specification:

**A short batch cannot strand work.** Spec 003 believed it could, and left comments in two test files
saying so, which is why the confirming claim exists. Measured against a real database, it cannot: the
claim is one statement in one transaction on an engine that serialises writers, so no cancellation can
interleave between the subquery and the outer predicate. The exposure this feature accepts is work
arriving *after* a batch, which is already the exposure a zero-row exit accepts today.

**Three existing expectations change, not one.** All three are iteration counts, in three files. No
promotion count moves anywhere in the suite, which is the evidence that business behaviour is untouched.

## Technical Context

**Language/Version**: TypeScript 5.9.3 on Node.js 22 or newer, unchanged. Verified here on 24.19.0.

**Primary Dependencies**: none added. This feature installs nothing, and touching the dependency set
would itself be a signal that the change had grown beyond its brief.

**Storage**: none. No table, column, index, trigger or migration. `npx drizzle-kit generate` must
continue to report no pending change, which is the mechanical proof that this feature is not a
persistence change wearing a scheduler's clothes.

**Testing**: Jest 30 with ts-jest through the existing `createLifecycleHarness`, against a real SQLite
database. The tick is invoked directly via `runTick()`, which Spec 003 exposed for exactly this reason,
so nothing here waits on a five-minute schedule or on wall-clock time.

**Target Platform**: unchanged, single process, single writer.

**Project Type**: web service. This feature touches one file of production code.

**Performance Goals**: one fewer write transaction per tick against a drained or short backlog. Stated
as a claim count rather than a duration, because Spec 004's timing work established that wall-clock
measurement on this machine has an eightfold run-to-run spread and cannot resolve a difference this
size. The claim count is exact, observable in the tick record, and is what the tests assert.

**Constraints**: Constitution Principle III is the binding one and it is unusually specific — it
mandates the cap, mandates returning once the cap is reached, mandates per-chunk transactions, and
calls the cap a safety property rather than a tuning knob. Nothing here may weaken any of that. The
loop must remain provably bounded by inspection, not by argument.

**Scale/Scope**: one production file (`src/scheduler/order-promotion.task.ts`), one added result
field, three amended test expectations, two amended comments, one new test file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.1.0**.

| Principle | Verdict | Basis |
| :--- | :--- | :--- |
| I. Centralized State Machine | **PASS** | No transition logic is added, moved or branched on. The target status still comes from `sourceStatusesFor` and the job still writes no status literal of its own. The loop decides *how many times to claim*, never *what to claim or what to write* |
| II. Lock-Free Atomic Transitions | **PASS** | The claim statement is untouched, including the outer status predicate. R1 examined that predicate closely and concluded it must stay: it is what excludes an order cancelled before the tick, which is the interleaving the concurrency suite actually drives. The decision still comes from the driver's changed-row count — this feature simply reads that count for one more purpose |
| III. Bounded Background Processing | **PASS**, and deliberately conservative | The cap is enforced, configurable, positive, and unchanged in default. It remains the `while` condition rather than an internal `break` (R3), so boundedness is a property of the loop's shape. Each chunk still commits in its own transaction and no transaction spans chunks or a tick. The principle's "MUST return once the cap is reached" is satisfied unchanged |
| IV. Exact-Integer Money and Immutable History | **PASS** | No monetary value is read, written, derived or documented. No historical row is touched |
| V. Two-Phase Keyset Reads | **PASS** | No listing, no cursor, no ordering column changes. The claim's `ORDER BY created_at_us, id` is untouched |
| VI. Integration-Proven Verification | **PASS** | Every requirement is exercised against the real assembled application and a real database. The principle explicitly names "a background tick honouring its iteration cap against a backlog larger than that cap" as a required integration test; that test exists, is unchanged by this feature, and is joined by its mirror — a tick ending before the cap because the work ran out |
| Scope: single currency | **PASS** | Not touched |
| Scope: Drizzle as sole persistence path | **PASS** | The claim still goes through `backlogClaimQuery`. No raw SQL is introduced |
| Workflow: build fails on zero tests | **PASS** | `passWithNoTests: false` unchanged |

**Gate result: PASS, with no recorded deviation.** Complexity Tracking below is empty and says so.

Three things are worth stating rather than leaving a reviewer to reconstruct.

**The requirement and the constitution disagree about syntax, and the constitution wins.** FR-002 says
the iteration count must not be the condition that ordinarily ends a run. Read literally that is an
instruction to write `while (true)`. Principle III calls the cap the safety property that keeps the
process responsive, on a synchronous driver where an unbounded claim loop holds the write lock for as
long as it runs. R3 resolves this by treating FR-002 as a statement about behaviour: the cap stays in
the `while`, the short-batch exit fires first in every ordinary case, and the cap stops being what
ordinarily ends a run without ever stopping being what guarantees a run ends. A reviewer who expects
`while (true)` and finds `while (iterations < maxIterations)` should read R3 before filing it as a miss.

**This feature reverses a considered decision, not an oversight.** Spec 003 chose to stop only on a
zero-row claim and wrote down why. The reasoning was sound given its premise; the premise was wrong.
The comments recording it are amended rather than deleted, so the next reader sees that the question
was asked twice and answered differently the second time with a measurement attached.

**Adding a field to a log record is a contract change.** FR-022 permits it only as an addition. The
existing record's fields keep their names and meanings, and R4 verified that no assertion in the suite
compares a tick record exhaustively, so nothing downstream breaks.

## Project Structure

### Documentation (this feature)

```text
specs/005-fix-scheduler-loop/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── scheduler-tick.md     # Phase 1 output: the tick's observable contract
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/scheduler/
└── order-promotion.task.ts    # the loop, the TickResult shape, the tick record

test/integration/lifecycle/
├── promotion.termination.spec.ts   # NEW: this feature's own suite
├── promotion.bounded.spec.ts       # one iteration count amended
├── promotion.claim.spec.ts         # one iteration count and its comment amended
└── promotion.lifecycle.spec.ts     # one iteration count and its comment amended
```

**Structure Decision**: no new directory and no new module. The change belongs inside the class that
already owns the loop, and extracting a "termination policy" abstraction for one predicate would add a
seam where the constitution wants a short readable loop.

The new tests go in `test/integration/lifecycle/` beside the existing promotion suites rather than in
a folder of their own, because they are more promotion tests, and a reviewer looking for scheduler
behaviour should find all of it in one place. Spec 004 created `test/integration/docs/` because it
introduced a genuinely new surface; this feature does not.

## Phase 1 Design

The shape of the loop, stated once here so the tasks do not have to re-derive it:

```text
while iterations < maxIterations:
    claimed   = claim one chunk        # unchanged statement, own transaction
    iterations += 1
    promoted  += claimed
    if claimed < chunkSize:            # the new ordinary exit
        stopReason = drained
        break
else:
    stopReason = guard
```

Everything else in `runTick` is untouched: the `try/catch` that records a failure and returns what was
already committed, the duration measurement, and the tick record.

`stopReason` takes three values. `drained` means a batch came back short, so the backlog is empty.
`guard` means the cap ended the run and a backlog remains. `failed` means a claim threw, which already
returns early and already emits `order.promotion.failed`.

Note the interaction R5 examined: a backlog that is an exact multiple of chunk times cap fills every
batch, never produces a short one, and therefore exits by the guard reporting `stopReason: guard` and
`capReached: true` while in fact being drained. This is correct and is today's behaviour. The next tick
finds an empty queue and costs one claim.

**Output**: [data-model.md](data-model.md), [contracts/scheduler-tick.md](contracts/scheduler-tick.md),
[quickstart.md](quickstart.md)

## Constitution Re-check (post-design)

Unchanged: **PASS**. The design added no persistence, no dependency, no module, no transition logic and
no monetary or ordering path. The one added field is additive and observable. The loop remains bounded
by its own condition, which is the property Principle III cares about most.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. This section is intentionally empty.

Spec 002 recorded one deviation. Specs 003 and 004 recorded none, and neither does this one. It removes
a statement rather than adding a capability, which is the rare kind of change that makes a system
smaller.
