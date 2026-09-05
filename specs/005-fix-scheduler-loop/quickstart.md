# Quickstart: Fix Scheduler Processing Loop

**Feature**: [spec.md](spec.md) | **Contract**: [contracts/scheduler-tick.md](contracts/scheduler-tick.md)

Seven scenarios that prove the feature from outside the loop. Scenarios 1 to 3 are the change itself.
Scenarios 4 to 7 are the guarantees that must survive it.

This feature has no HTTP surface, so unlike Spec 004's quickstart there is no page to click. The tick
is driven directly, which is why `runTick()` was made public in the first place, and observed through
the database and the log record.

## Prerequisites

```bash
npm install
cp .env.example .env
npm run db:migrate
```

No seeding is needed. These scenarios create their own orders.

## Scenario 1: A short backlog costs one claim, not two

This is the defect, and the smallest thing that demonstrates it.

Seed fewer orders than one chunk, run one tick, and read the iteration count from the tick record.

**Expected**: `iterations: 1`, `promoted` equal to the number seeded, `capReached: false`,
`stopReason: "drained"`.

**Before this feature**: `iterations: 2`. The second claim matched nothing and existed only to
confirm what the first already proved.

Verify from the suite:

```bash
npm test -- --testPathPatterns='promotion.termination'
```

## Scenario 2: An empty backlog still costs exactly one claim

Run a tick against no eligible orders at all.

**Expected**: `iterations: 1`, `promoted: 0`, `stopReason: "drained"`.

This is unchanged behaviour and is here so that a future change cannot regress it while looking like
an improvement. One claim is the floor: a tick cannot know the queue is empty without asking once.

## Scenario 3: A full batch still asks again

Seed exactly one chunk's worth of orders.

**Expected**: `iterations: 2`, `promoted` equal to the chunk size, `stopReason: "drained"`.

A full batch is not evidence the backlog is empty, so the second claim is genuinely required. This is
the boundary that makes the comparison `claimed < chunkSize` rather than `claimed <= chunkSize`, and
getting it wrong in the other direction would strand a full chunk of work every tick.

## Scenario 4: The cap still stops a runaway tick

Seed far more than chunk size times the cap.

**Expected**: `iterations` equal to the cap exactly, `promoted` equal to chunk size times the cap
exactly, `capReached: true`, `stopReason: "guard"`. The remainder stays `pending`.

Then run further ticks and confirm the backlog drains across them with nothing lost, skipped or
promoted twice.

**This is the scenario that matters most if the change was made carelessly.** Demoting the cap from
loop condition to internal guard is the edit that turns a bounded loop unbounded, and on a synchronous
driver an unbounded claim loop holds the write lock and blocks the event loop for as long as it runs.

## Scenario 5: The tick is bounded even against a backlog that refills

Arrange for eligible work to exist before every claim, so no batch is ever short.

**Expected**: the tick still stops, at exactly the cap. `iterations` never exceeds
`ORDER_PROMOTION_MAX_ITERATIONS` under any arrangement.

The tick must terminate without relying on the backlog running out. That is the difference between a
loop with a guard and a loop that happens to finish.

## Scenario 6: Nothing about which orders move has changed

```bash
npm test
```

**Expected**: the entire suite passes, with exactly three amended expectations, all iteration counts:

| File | Test | Was | Now |
| :--- | :--- | ---: | ---: |
| `promotion.bounded.spec.ts` | ends early when the backlog runs out | 2 | 1 |
| `promotion.claim.spec.ts` | commits each chunk separately | 5 | 4 |
| `promotion.lifecycle.spec.ts` | records what each tick did | 3 | 2 |

Every promotion count, every ordering assertion, every concurrency assertion and every failure
assertion passes untouched. **Any fourth test needing an edit means something changed that should not
have** — investigate it as a defect rather than adjusting the test.

Confirm no persistence crept in:

```bash
npx drizzle-kit generate
```

**Expected**: "No schema changes, nothing to migrate".

## Scenario 7: An operator can see why a tick stopped

Start the service and read the tick records. Shorten the cadence first, or the first tick is five
minutes away:

```bash
SCHEDULER_INTERVAL_MS=2000 npm run start:dev
```

**Expected**: each `order.promotion.tick` record carries `stopReason` alongside the existing
`iterations`, `promoted`, `capReached` and `durationMs`. No existing field is missing or renamed.

```json
{
  "message": "order.promotion.tick",
  "task": "order-promotion",
  "iterations": 1,
  "promoted": 4,
  "capReached": false,
  "durationMs": 0,
  "stopReason": "drained"
}
```

Against an idle service the reason is `drained` every tick. Against a backlog deeper than the cap it
is `guard`, which is the signal that promotion is not keeping up — consecutive `guard` ticks mean the
backlog is growing faster than one tick can drain it.

`failed` appears only when a claim throws, and is accompanied by the unchanged
`order.promotion.failed` record. Before this feature, a drained tick and a failed tick were
indistinguishable from the tick record alone.

## Teardown

Stop the service with Ctrl+C and expect `shutdown.started` followed by `shutdown.complete`.

```bash
rm -f data/oms.db data/oms.db-wal data/oms.db-shm
```
