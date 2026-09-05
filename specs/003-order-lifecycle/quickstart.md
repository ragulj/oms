# Quickstart: Validating Order Lifecycle and Processing

**Feature**: [spec.md](spec.md) | **Data model**: [data-model.md](data-model.md) | **Contract**: [contracts/http-api.md](contracts/http-api.md)

How to prove this feature works once it is built. Every scenario runs against a real database file
through the real application graph, per Constitution Principle VI. Nothing here is mocked.

## Prerequisites

Node 22 or newer, and the repository set up per Spec 001 and Spec 002. This feature adds **no new
dependency**: request validation reuses the zod already present for configuration, and the HTTP test
client is the `supertest` already installed.

## Setup

1. Install dependencies, if you have not already:

   ```bash
   npm install
   ```

2. Generate the migration for the one table this feature adds:

   ```bash
   npm run db:generate
   ```

3. Apply every migration to the development database:

   ```bash
   npm run db:migrate
   ```

4. Populate the customer and product dependencies. Spec 002 owns those tables as placeholders and no
   endpoint writes them, so this is how usable identifiers come to exist:

   ```bash
   npm run db:seed
   ```

   Expected: the command prints the customer and product identifiers it created, and running it a
   second time neither duplicates them nor fails.

5. Run the full suite:

   ```bash
   npm test
   ```

   Expected: every test passes and the run reports a non-zero test count. A zero-test run is a build
   failure by design.

6. Start the service to exercise it by hand:

   ```bash
   npm run start:dev
   ```

## Scenario 1: An order is placed and read back (User Story 1, User Story 2)

Using identifiers from step 4:

```bash
curl -sS -X POST localhost:3000/api/v1/orders -H 'content-type: application/json' -d '{"customerId":1,"lines":[{"productId":1,"quantity":3}]}'
```

**Expected**: 201, a `Location` header, status `pending`, `createdAtUs` equal to `updatedAtUs`, a
`unitPriceMinor` that came from the catalog rather than from the request, and a `totalMinor` that is
the exact integer sum of the line totals.

Then fetch it back at the path in `Location`. Every field matches.

**Also check the refusals.** Each of these must fail, and the first two must leave nothing stored:

- a line naming a product that does not exist
- an empty `lines` array
- a body carrying `unitPriceMinor`, `totalMinor`, or `status`

The third one is the one worth watching. A plain zod object schema **silently discards** unknown keys
and reports success, which would give a caller a 201 for a request whose price field was thrown away.
Research [R1](research.md) records the measurement; the contract requires strict schemas and a test
asserts the rejection.

## Scenario 2: A retry does not create a second order (User Story 1)

Send the same creation request twice with the same `Idempotency-Key` header.

**Expected**: 201 then 200, the same order identifier both times, `Idempotent-Replay: true` on the
second, and exactly one order in the table.

Then send a third request with that same key and a different body.

**Expected**: 409, and still exactly one order.

## Scenario 3: Paging is bounded and complete (User Story 3)

Seed 10,000 orders, including some that deliberately share a creation timestamp. Page the whole set
with `limit=50`, following `nextCursor` until it is null.

**Expected**: every order appears exactly once. No duplicates, no omissions, and the orders sharing a
timestamp appear contiguously in descending identifier order.

Then take the query plan for both listing queries, filtered and unfiltered.

**Expected**: each names an index and none reports a full scan.

**Do not skip the filtered plan.** The logically identical OR form of the cursor predicate produces a
plan that constrains only `status` and then walks every row of it, which is a scan wearing an index's
name. Research [R4](research.md) has the measured comparison. This is why the predicate is a row-value
comparison and why the plan assertion covers the filtered case and not just the plain one.

Also confirm the rejections: `limit=0`, `limit=101`, `offset=10`, and a corrupted cursor must each be
refused rather than clamped or ignored.

## Scenario 4: Cancellation is decided by the database (User Story 4)

Cancel a pending order.

**Expected**: 200, status now `cancelled`, `updatedAtUs` advanced, `createdAtUs` unchanged even though
the update statement named neither timestamp.

Cancel the same order again.

**Expected**: 409 naming the current status. Then cancel an order that is already `processing`: 409.
Then cancel an identifier that does not exist: 404, not 409.

That last distinction is the interesting one. Both a missing order and a moved order produce a
changed-row count of zero, and the two are told apart by a read that happens **after** the update has
already failed, purely to classify it. Reading first, to decide the transition, is what Principle II
forbids.

Finally, apply two cancellations against one pending order in both orders of arrival.

**Expected**: exactly one reports a change and exactly one reports none, every time. The order ends
`cancelled` and its line items are untouched.

## Scenario 5: A tick does not finish the work (User Story 5)

Seed 5,000 pending orders and invoke a single tick directly, without waiting for the schedule.

**Expected**: exactly 1,000 orders promoted at the default chunk size of 100 and iteration cap of 10.
The other 4,000 are still `pending`.

This is the scenario whose requirement is the opposite of every other one: the tick is correct
*because* it stopped early. An implementation that drains the whole backlog in one tick has failed
this, not passed it.

Then check the rest of the tick's behaviour:

- a backlog smaller than one chunk ends the tick early rather than running all ten iterations
- cancelled orders in the backlog are never promoted, and the exclusion comes from the statement's
  own predicate rather than from a filter applied after reading
- the oldest pending orders are the ones promoted
- a tick still running when the next is due causes that one to be skipped, and the skip is recorded
- no new tick begins once shutdown has started

## Scenario 6: Isolation still holds, with a third cleanup phase

Run the suite twice in a row, then run a single lifecycle test file alone.

**Expected**: identical results all three times.

This is worth checking explicitly, because cleanup now has three ordered phases rather than two. The
new `idempotency_records` table holds a foreign key into `orders`, and `DROP TABLE orders` is
**refused** while any such row exists. Research [R6](research.md) has the measurement. If the phases
are ever reordered, every test touching an order fails with a foreign key error raised during a table
drop, and nothing in that message points at the cleanup order.

## Scenario 7: The guarantees are load-bearing

Remove one guarantee at a time from the implementation and confirm the suite turns red for each:
the strict request schemas, the expected-status predicate in the conditional update, the outer status
predicate in the bounded claim, the iteration cap, the exactness check on the derived total, the
cursor's tiebreaker, and the idempotency key's unique constraint.

**Expected**: every one of them fails at least one test. A guarantee whose removal leaves the suite
green is not verified, whatever the requirement says. Spec 002 established this practice and found
that all eleven of its schema guarantees held; this feature repeats it against its own.
