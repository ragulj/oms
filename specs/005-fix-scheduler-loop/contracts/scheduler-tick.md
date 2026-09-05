# Contract: Scheduler Tick Termination

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

The background promotion tick has no HTTP surface. Its contract is what one invocation does to the
database and what it reports, and this file states it as a table of backlog states so the behaviour
can be checked by enumeration rather than by reading the loop.

## The rule, in one line

A tick claims batches until one comes back smaller than the chunk size, or until the iteration cap
stops it, whichever happens first.

## Termination table

Chunk size `C`, iteration cap `M`, backlog `N` eligible orders, no concurrent writes.

| Backlog `N` | Claims performed | Promoted | `capReached` | `stopReason` |
| :--- | :--- | :--- | :--- | :--- |
| `0` | 1 | 0 | false | `drained` |
| `0 < N < C` | 1 | `N` | false | `drained` |
| `N = C` | 2 | `N` | false | `drained` |
| `C < N < C×M`, `N` not a multiple of `C` | `⌈N/C⌉` | `N` | false | `drained` |
| `C < N < C×M`, `N` a multiple of `C` | `N/C + 1` | `N` | false | `drained` |
| `N = C×M` | `M` | `C×M` | **true** | `guard` |
| `N > C×M` | `M` | `C×M` | **true** | `guard` |
| any, claim throws on batch `k` | `k` | sum of batches `1..k-1` | false | `failed` |

Two rows deserve attention.

**`N = C` costs two claims, and that is correct.** A full batch is not evidence the backlog is empty,
so the tick must ask again. The same applies to any exact multiple of `C`. This is the one place the
old and new behaviour agree on paying for a confirming claim, and it is the reason the comparison is
`claimed < C` rather than `claimed <= C`.

**`N = C×M` reports the guard while being drained.** Every batch is full, so no short batch ever
occurs and the cap is genuinely what ends the run. Reporting `drained` would require knowing the queue
is empty, which costs the very claim this feature removes. The next tick finds an empty queue and
costs one claim. See research R5.

## Before and after

The rows that change, with everything else identical:

| Backlog | Chunk | Claims before | Claims after | Promoted |
| ---: | ---: | ---: | ---: | :--- |
| 5 | 10 | 2 | **1** | 5, unchanged |
| 150 | 100 | 3 | **2** | 150, unchanged |
| 350 | 100 | 5 | **4** | 350, unchanged |
| 0 | 100 | 1 | 1 | 0, unchanged |
| 100 | 100 | 2 | 2 | 100, unchanged |
| 5,000 | 100 | 10 | 10 | 1,000, unchanged |

No promotion count moves. That is the contract's central claim and the reason this is a scheduler
change rather than a business-behaviour change.

## Boundedness

Under every backlog state, including one refilled between every batch by a concurrent writer:

```text
1 <= iterations <= maxIterations
```

The upper bound is structural: the cap is the loop's own condition, so no sequence of batch results
can produce more claims than the cap allows. The lower bound holds because the first claim is issued
before any result exists to stop on.

A tick always terminates. Termination does not depend on the backlog eventually becoming empty.

## Preserved guarantees

Unchanged by this feature, and asserted by tests that must pass without modification:

| Guarantee | Where it lives |
| :--- | :--- |
| Each batch commits in its own transaction | The claim's own `db.transaction(...)` |
| No transaction spans two batches or a tick | Same |
| Orders claimed oldest first | The claim's `ORDER BY created_at_us, id` |
| A cancelled order is never promoted | The claim's outer status predicate |
| The target status comes from the state machine | `sourceStatusesFor(TARGET_STATUS)` |
| Ticks do not overlap; a skip is recorded | `OverlapGuard`, untouched |
| No new tick begins after shutdown starts | Same |
| A failure leaves committed batches committed | The `try/catch` in `runTick` |
| A tick is directly invocable | `runTick()` remains public |

## Log record

`order.promotion.tick`, emitted once per successful tick. Existing fields keep their names and
meanings; `stopReason` is added.

```json
{
  "message": "order.promotion.tick",
  "task": "order-promotion",
  "iterations": 2,
  "promoted": 150,
  "capReached": false,
  "durationMs": 4,
  "stopReason": "drained"
}
```

`order.promotion.failed` is unchanged and still emitted on the failure path, instead of
`order.promotion.tick`, never alongside it.

**Convergence decision (T034)**: FR-023 requires the stop reason to be readable from the record
alone, without correlating separate records. On the failure path that requirement is met by the
`message` field itself: `order.promotion.failed` is the third value of the same three-way outcome
`order.promotion.tick`'s `stopReason` carries the other two for, and the two message names are
mutually exclusive for a given tick. A reader does not need a second record to learn a tick failed;
they need only the one record that was emitted, and its name is the answer. `stopReason` is
therefore deliberately **not** duplicated onto `order.promotion.failed` — doing so would carry the
same fact twice on every failure and invite the two to disagree. The returned `TickResult` (not
logged directly, but available to a direct caller per FR-020) does carry `stopReason: 'failed'` for
this same case, so the in-process caller and the log reader are told the same thing through the
channel each of them actually reads.

An operator reading one record can now answer "why did this tick stop?" without finding a second one.
`stopReason: "guard"` on consecutive ticks is the signal that the backlog is not keeping up; before
this feature that signal was `capReached`, which remains and still means the same thing.
