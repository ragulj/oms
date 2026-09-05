# Phase 1 Data Model: Fix Scheduler Processing Loop

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## No persistent data

This feature adds no table, column, index, trigger, constraint or migration, and reads and writes no
stored value it did not already. `npx drizzle-kit generate` must continue to report no pending schema
change, and that is a task rather than a hope.

The only entities here are in-memory results that live for the length of one tick.

## TickResult

The value `runTick()` returns, and the payload of the `order.promotion.tick` log record. One field is
added; nothing is removed, renamed, or given a new meaning.

| Field | Type | Status | Meaning |
| :--- | :--- | :--- | :--- |
| `iterations` | integer ≥ 1 | unchanged | Claims actually performed. This is the number the feature reduces, so it is the number the tests assert |
| `promoted` | integer ≥ 0 | unchanged | Orders moved to `processing`. Must not change for any backlog |
| `capReached` | boolean | unchanged | `iterations >= maxIterations`. See R5: true for a backlog that is an exact multiple of chunk times cap, even though that backlog is drained |
| `durationMs` | integer ≥ 0 | unchanged | Elapsed wall time for the tick |
| `stopReason` | `'drained' \| 'guard' \| 'failed'` | **added** | Why the run ended, readable without correlating records (FR-023) |

### stopReason

| Value | Set when | Relationship to `capReached` |
| :--- | :--- | :--- |
| `drained` | A batch claimed fewer rows than the chunk size, so no eligible order remained | `false` in every case except an exact multiple of chunk times cap, which reports `guard` instead |
| `guard` | The iteration cap ended the run with a backlog remaining, or with a backlog that happened to end exactly on the boundary | always `true` |
| `failed` | A claim threw. Committed chunks stay committed and the tick returns early | always `false` |

`stopReason` is not derivable from the existing fields, which is why it is added rather than computed
at read time. `capReached` separates `guard` from the other two, but a successful drain and a failed
tick both report `capReached: false`, and telling them apart today means going and finding whether an
`order.promotion.failed` record exists. FR-023 forbids requiring that correlation.

### Invariants

- `iterations >= 1` always. A tick performs at least one claim, including against an empty backlog.
- `iterations <= maxIterations` always, under every backlog state including one refilled between
  batches. This is the boundedness property and it is asserted directly.
- `promoted <= iterations * chunkSize` always.
- `stopReason === 'guard'` if and only if `capReached === true`.
- `promoted` for a given backlog is identical before and after this feature. Nothing about which
  orders move, or in what order, changes.

## Batch claim

One bounded attempt to move a capped set of `pending` orders to `processing`, committed on its own.
Unchanged by this feature except in how its result is read.

| Property | Value |
| :--- | :--- |
| Statement | Unchanged, including the outer status predicate |
| Transaction | Its own, per Principle III. No transaction spans two chunks or a tick |
| Result | The driver's changed-row count |
| Result used for | Previously: continue unless zero. Now: continue only if it equals the chunk size |

The whole feature is that last row. The claim itself, the ordering, the exclusion of cancelled orders,
and the transaction boundary are all untouched.

**Why the comparison is against the chunk size rather than zero**: research R1 measured that a batch
returning fewer rows than requested proves fewer than that many eligible orders existed when the
statement ran, because the statement is atomic on a single-writer engine and nothing can interleave
within it. A zero-row result is just the special case where that count was zero.

## Configuration

No new setting. `ORDER_PROMOTION_CHUNK_SIZE` and `ORDER_PROMOTION_MAX_ITERATIONS` keep their names,
their validation, and their defaults of 100 and 10. `.env.example` is unchanged.

The chunk size gains a second role: it was the claim's `LIMIT`, and it is now also the threshold the
batch result is compared against. Those are the same number by construction — the comparison asks
whether the statement returned everything it asked for — so no drift is possible between them, and
nothing needs to keep them in step.
