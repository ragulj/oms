# Phase 0 Research: Fix Scheduler Processing Loop

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-05

Five questions. Two of them changed the specification, which is recorded here rather than smoothed
over: a plan that quietly corrects the thing it is planning against leaves nobody able to tell which
document is true.

---

## R1: Can a short batch leave eligible work behind?

**This is the load-bearing question of the whole feature.** If a short batch can leave work behind,
ending the run on one is a correctness change and needs a much more careful argument. If it cannot,
the extra claim is pure waste and removing it is nearly free.

Spec 003 answered *yes* and left a comment saying so, in two test files:

> FR-085 ends a tick on a zero-row claim, not on a short one: a short chunk is not evidence the
> backlog is empty.

That reasoning came from the claim statement's outer status predicate, which Spec 003 describes as
excluding "an order cancelled in the interval between the subquery choosing it and the update
reaching it". If such an interval exists, a batch can come back short while pending orders remain,
and stopping on it would strand them.

**Measured.** The claim is one statement:

```sql
UPDATE orders SET status = 'processing'
WHERE id IN (SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at_us, id LIMIT ?)
  AND status = 'pending'
```

issued inside `db.transaction(...)`. Driving it against a real SQLite database over a 250-order
backlog with a chunk of 100:

```text
iteration 1: claimed 100 FULL  | pending remaining 150
iteration 2: claimed 100 FULL  | pending remaining 50
iteration 3: claimed  50 SHORT | pending remaining 0
iteration 4: claimed   0 SHORT | pending remaining 0
```

A short batch left nothing behind, and iteration 4 is exactly the claim this feature removes.

**Decision**: a short batch ends the run.

**Rationale**: there is no interval. The subquery and the outer predicate are evaluated within a
single statement, in a single transaction, on an engine that serialises writers — a competing
cancellation cannot run between them, because it cannot hold the write lock while this statement does.
The outer predicate is still correct, still constitutionally required, and still load-bearing for the
*sequential* interleaving Spec 003's concurrency tests actually drive (cancel, then tick). It simply
cannot produce a short batch mid-statement.

So a short batch proves that fewer than a full batch of eligible orders existed at the moment it ran.
The only way work outlives it is arrival *afterwards*, which the next run collects — and which is
already true today of a run that stops on an empty batch. This change does not introduce that
exposure; it declines to pay a claim per run to shrink a window it cannot close anyway.

**Alternatives considered**: keep the confirming claim and accept the cost, which is the status quo
and was rejected once the interval was shown not to exist. Compare against a fresh count of eligible
orders instead of the batch size, rejected because it substitutes one extra query for another while
adding a second source of truth.

**Consequence for the spec**: the edge case "a batch comes back short because an order was cancelled
mid-run" was removed, and the Assumptions section was corrected. Spec 003's two explanatory comments
now contradict the code and must be rewritten, not merely re-numbered.

---

## R2: How many existing expectations change?

The specification originally claimed one. **It is three.**

Every assertion in the suite that reads an iteration count was enumerated and traced by hand against
both the current and the proposed loop:

| Test | Backlog | Chunk | Today | After | Promoted |
| :--- | ---: | ---: | ---: | ---: | :--- |
| `promotion.bounded` — ends early when the backlog runs out | 5 | 10 | 2 | **1** | 5, unchanged |
| `promotion.claim` — commits each chunk separately | 350 | 100 | 5 | **4** | 350, unchanged |
| `promotion.lifecycle` — records what each tick did | 150 | 100 | 3 | **2** | 150, unchanged |
| `promotion.bounded` — promotes exactly chunk times cap | 5,000 | 100 | 10 | 10 | 1,000, unchanged |
| `promotion.bounded` — drains a backlog across ticks | 2,500 | 100 | 6 on tick 3 | 6 | unchanged |
| `promotion.bounded` — honours the configured bounds | 100 | 10 | 3 | 3 | 30, unchanged |
| `promotion.bounded` — ends after one claim when empty | 0 | 10 | 1 | 1 | 0, unchanged |
| `promotion.lifecycle` — reports the cap being reached | 2,000 | 100 | 10 | 10 | 1,000, unchanged |
| `scheduler.fires` — leaves observable evidence | 0 | 100 | 1 | 1 | 0, unchanged |

**Decision**: three named exceptions, recorded in FR-028, each a reduced claim count with an unchanged
promotion count.

**Rationale**: the pattern is uniform and is the feature working. Every changed row is one where the
final batch was short; every unchanged row either ends on a full batch at the cap or ends on an empty
first batch. Not one promotion count moves, which is the evidence that business behaviour is untouched.

The three cases where the count *stays* at the cap deserve naming, because they look like the defect
and are not: a backlog of exactly 5,000 with chunk 100 and cap 10 fills every batch, so no batch is
ever short and the guard is genuinely what ends the run. That is correct today and stays correct.

**Alternatives considered**: adjusting the tests to hide the change, rejected outright — the reduced
count *is* the deliverable, and a test that cannot see it is not testing this feature.

---

## R3: Where does the guard belong in the loop?

**Decision**: keep `while (iterations < maxIterations)` as the loop condition and add the short-batch
exit inside it.

**Rationale**: FR-002 requires the batch result to be what ordinarily ends a run, and FR-010 requires
that the loop cannot become unbounded. Those pull in opposite directions if read as instructions about
syntax, and the resolution is that FR-002 is about *behaviour* while FR-010 is about *structure*.

Leaving the cap in the `while` makes boundedness a property of the loop's shape, provable by reading
one line, rather than a property of a `break` somebody might later move. The short-batch exit then
fires first in every case where the queue is not deeper than the guard allows, so the guard stops
being what ordinarily ends a run without ever stopping being what guarantees a run ends.

The alternative, `while (true)` with the cap enforced by an internal `break`, reads more like the
requirement's wording and is strictly worse: it makes an unbounded loop one deleted line away, on a
synchronous driver where an unbounded claim loop holds the write lock and blocks the event loop for
as long as it runs. Constitution Principle III calls the cap "the safety property that keeps the
process responsive", not a tuning knob. Structure that cannot express the unsafe state is worth more
than structure that matches the sentence.

**Alternatives considered**: a `do/while` with the guard in the condition, equivalent but obscures the
empty-backlog case; a recursive formulation, rejected as needless.

---

## R4: How is the reason a run ended made visible?

**Decision**: add a `stopReason` field to the tick result and the tick log record, with three values —
`drained`, `guard`, `failed`.

**Rationale**: FR-023 requires the reason to be readable from one record without correlating others or
inferring from arithmetic. Today an operator can *almost* derive it: `capReached` distinguishes the
guard, and the failure path emits a separate `order.promotion.failed` record. But the failure path
also returns `capReached: false`, so a successful drain and a failed run are indistinguishable in the
tick record itself, and telling them apart means finding a second record.

`stopReason` is additive. FR-022 forbids removing or renaming an existing field, and no existing field
changes meaning: `capReached` keeps its current definition, `iterations` keeps counting claims actually
performed, and `promoted` and `durationMs` are untouched.

Adding a field is only safe if nothing asserts the record exhaustively, so that was checked rather
than assumed. Three places read it: two `toMatchObject` calls in `promotion.lifecycle.spec.ts` and one
field read in `scheduler.fires.spec.ts`. The suite's only `toEqual` near a tick is on an array of
promoted counts, not on a result object. No assertion compares a whole record, so an added field
breaks none of them.

**Alternatives considered**: deriving the reason at read time from `capReached` plus the presence of a
failure record, rejected because FR-023 exists precisely to stop that; a boolean `drained` flag,
rejected because three states do not fit in a boolean and the failure case is the one worth naming.

---

## R5: Does `capReached` still mean what it meant?

**Decision**: unchanged, `iterations >= maxIterations`.

**Rationale**: worth checking rather than assuming, because a backlog that is an exact multiple of
chunk times cap ends by the guard while also being fully drained. A run over exactly 1,000 orders at
chunk 100 and cap 10 fills every batch, never sees a short one, and exits by the guard reporting
`capReached: true` — even though nothing is left. That is true today and stays true, and it is not a
defect: the run genuinely stopped because it hit the guard, and the operator reading "the cap was
reached" should go and look at whether the backlog is keeping up. The next run finds an empty queue
and costs one claim.

**Alternatives considered**: reporting `capReached: false` when the queue happens to be empty at the
guard, rejected — it would require an extra query to know, which is the cost this feature removes.

---

## Summary of decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| R1 | Can a short batch strand work? | No. Measured. A short batch ends the run |
| R2 | How many tests change? | Three, all iteration counts, no promotion count moves |
| R3 | Where does the guard live? | Stays in the `while` condition; boundedness stays structural |
| R4 | How is the stop reason visible? | New additive `stopReason`: `drained`, `guard`, `failed` |
| R5 | Does `capReached` change? | No |

No NEEDS CLARIFICATION markers remain.
