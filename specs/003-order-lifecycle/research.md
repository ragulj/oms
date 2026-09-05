# Phase 0 Research: Order Lifecycle and Processing

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every claim below was executed against this repository's installed toolchain rather than recalled.
Three findings changed the design, and one of them would have broken the entire existing test suite in
a way that looks like a bug in the test harness rather than in this feature.

## Verified environment

| Fact | Value | How it was established |
| :--- | :--- | :--- |
| Runtime | Node 24.19.0, floor `>=22` | unchanged from Spec 001 |
| Validation library available | `zod` 4.5.4 | already a dependency, already used for configuration |
| `class-validator` / `class-transformer` | **not installed** | absent from `package.json` |
| HTTP test client | `supertest` 7.2.2 | existing dev dependency |
| Driver result shape | `{ changes, lastInsertRowid }` | executed |
| SQLite | 3.53.4 via better-sqlite3 13.0.3 | unchanged from Spec 002 |

## R1. Request validation uses zod, and plain object schemas are not enough

**Decision**: validate every request body and query string with a zod schema applied through a small
custom pipe, and use `z.strictObject` rather than `z.object` on every request contract.

**Why it needed checking**: NestJS's documented `ValidationPipe` is built on `class-validator` and
`class-transformer`, neither of which is installed. Adding them would introduce a second validation
vocabulary alongside the zod schema that already validates configuration.

**Measured**:

```text
z.object({a}).safeParse({a:1, b:2})        -> { success: true, data: { a: 1 } }   // b silently dropped
z.strictObject({a}).safeParse({a:1, b:2})  -> success: false, issue "unrecognized_keys"
z.object({a: z.number().int()}) rejects 1.5 and "3"
```

The first line is the finding. FR-003 requires an unrecognised property to cause rejection, and a
plain `z.object` **silently discards it and reports success**. A caller sending `unitPriceMinor` in a
creation request would get a 201 and no indication that the field it believed it controlled was
thrown away. Every request contract therefore uses `z.strictObject`, and a test asserts the rejection
rather than trusting the schema author to have picked the right constructor.

**Alternatives rejected**: installing `class-validator` to use the framework's own pipe, which adds
two dependencies and a decorator-based second way to describe the same constraints; and hand-rolled
validation, which puts the error-message quality on the author of each endpoint.

## R2. The bounded claim is expressible through Drizzle, so Spec 002's deviation does not recur

**Decision**: build the background job's claim with Drizzle's `inArray` against a select subquery. No
raw SQL, and no addition to the single deviation Spec 002 recorded.

**Why it needed checking**: Constitution Principle III mandates a literal SQL shape. Spec 002 had to
record a deviation because Drizzle has no trigger construct, and it was not obvious that this shape
would fare better.

**Measured** — the SQL Drizzle emitted, next to the constitution's text:

```sql
-- emitted by db.update(orders).set(...).where(and(inArray(orders.id, sub), eq(orders.status, ...)))
update "orders" set "status" = ?
where ("orders"."id" in (select "id" from "orders" where "orders"."status" = ?
                         order by "orders"."created_at_us" asc, "orders"."id" asc limit ?)
       and "orders"."status" = ?)
```

Parameters bound as `["processing", "pending", 100, "pending"]`, and the statement reported
`changes: 100` against a 1,000-row pending backlog. This is the constitution's shape term for term,
including the re-asserted status in the outer predicate.

**Consequence for the plan**: the Constitution Check passes with **no** deviation. Spec 002's
Complexity Tracking entry stands for that feature and is not inherited by this one.

## R3. The changed-row count is trustworthy, including on a multi-row claim under the touch trigger

**Decision**: decide every transition outcome from `changes` alone, as Principle II requires.

**Measured**:

```text
matched  update -> { changes: 1, lastInsertRowid: 3000 }
mismatched update -> { changes: 0, lastInsertRowid: 3000 }
100-row bounded claim -> { changes: 100 }
```

Spec 002's R6 established that the `orders_touch_updated_at` trigger does not inflate the count for a
single-row update. The third line extends that to the multi-row case that matters here: the trigger
fires once per claimed row and issues its own `UPDATE`, and the count still reports exactly the rows
the outer statement changed. Had it reported 200, the job's own accounting of how much backlog it had
drained would have been silently doubled.

## R4. Row-value cursors beat the OR form once a status filter is present

**Decision**: express the keyset predicate as `(created_at_us, id) < (?, ?)`.

**Why it needed checking**: Spec 002's `keyset-pagination.spec.ts` used the equivalent OR form,
`created_at_us < ? OR (created_at_us = ? AND id < ?)`. Both are logically identical. They do not plan
identically.

**Measured** against 3,000 orders:

| Query | Plan |
| :--- | :--- |
| row-value, no filter | `SEARCH orders USING COVERING INDEX orders_created_at_id_idx (created_at_us<?)` |
| row-value + status filter | `SEARCH orders USING COVERING INDEX orders_status_created_at_id_idx (status=? AND created_at_us<?)` |
| **OR form + status filter** | `SEARCH orders USING COVERING INDEX orders_status_created_at_id_idx (status=?)` |

The third row is the finding. With a status filter the OR form constrains only `status`, so the
engine walks every row of that status and discards the ones before the cursor. On a table where one
status holds most of the rows, that is a scan of that status wearing an index's name. The row-value
form constrains `created_at_us` as well and seeks straight to the cursor position.

Spec 002's test keeps its OR form. It proves the data model supports keyset paging, which it does, and
rewriting a previous feature's evidence to match this one's implementation choice would be scope creep.
This specification's own tests assert the plans its own read path produces.

## R5. Row-value paging is correct, not merely well-planned

**Decision**: adopt the predicate above with confidence in results, not just in cost.

**Measured** against 1,000 orders including 20 deliberately sharing a single microsecond:

```text
limit 7    total=1000 unique=1000 complete=true
limit 50   total=1000 unique=1000 complete=true
limit 137  total=1000 unique=1000 complete=true
filtered   total=334  unique=334  matches=true
collisions n=20 contiguous=true ordered=true
```

Every order appears exactly once at three page sizes that divide the table unevenly, the status filter
returns exactly the matching set, and the twenty colliding rows land contiguously and in strictly
descending identifier order, which is the tiebreaker doing the work Principle V describes.

## R6. The new table's foreign key breaks the existing per-test rebuild

**Decision**: clear `idempotency_records` **before** the order tables are rebuilt, in a distinct
ordered phase of the per-test hook.

**Why it needed checking**: Spec 002's harness rebuilds `order_line_items` and `orders` by dropping
and recreating them, because immutability triggers refuse row deletion. An idempotency record holds a
foreign key to an order. It was not obvious whether `DROP TABLE` respects foreign keys.

**Measured**:

```text
DROP TABLE orders, with an idem row referencing it -> REFUSED
  SQLITE_CONSTRAINT_TRIGGER | FOREIGN KEY constraint failed
DELETE FROM idem, then DROP TABLE orders           -> OK
```

This is the finding that would have cost the most. Adding the table with its foreign key and adding
its name to the existing deletable list produces a suite where **every test that touches an order
fails**, with an error naming a foreign key constraint during a table drop. The cause is in the order
of two cleanup phases, and nothing about the message points there.

The harness therefore gains a third, explicitly ordered list. The order is: clear tables whose rows
reference orders, then rebuild the order tables, then clear the remaining tables. Spec 002's existing
comment already explains why the rebuild has to precede the deletion of `customers` and `products`;
this adds the phase that has to precede the rebuild.

## R7. Duplicate keys are classified by error code, never by message

**Decision**: catch the driver's error and branch on `code === 'SQLITE_CONSTRAINT_UNIQUE'`.

**Measured**:

```text
name: SqliteError | code: SQLITE_CONSTRAINT_UNIQUE
message: UNIQUE constraint failed: idem.idempotency_key
```

The code is stable and the message is not: it embeds the table and column names, so a rename would
break a message match while leaving it compiling. The message is still worth reading to distinguish
*which* unique constraint fired if a second one is ever added, but the branch is on the code.

## R8. A rolled-back insert does not burn an identifier

**Decision**: the idempotent creation path may attempt the write and roll back on collision without
leaving gaps in the order sequence.

**Measured**: inserting row `a`, then a transaction inserting `b` that throws, then inserting `c`,
yields `c` at id 2. `AUTOINCREMENT`'s high-water mark is itself transactional.

**Consequence**: the design still reads the idempotency table first as a fast path, because the common
repeat is a retry rather than a race, and a read is cheaper than an attempted transaction. That read
is an optimisation and not the guarantee. The guarantee is the unique constraint, which FR-034 requires
explicitly, and the race is resolved by catching R7's error rather than by trusting the read.

## R9. Removing the heartbeat breaks two Spec 001 tests, and they must be rewritten rather than deleted

**Decision**: replace `HeartbeatTask` with the promotion job and rewrite the two tests that named it.

**Inventory**, established by reading the suite:

| File | Depends on | Action |
| :--- | :--- | :--- |
| `test/integration/scheduler.fires.spec.ts` | `HeartbeatTask`, the `scheduler.heartbeat` record | rewrite against the promotion job |
| `test/integration/scheduler.configurable.spec.ts` | the `scheduler.registered` record and its `intervalMs` | keeps passing if the new job emits the same record |
| `test/integration/scheduler.no-overlap.spec.ts` | `OverlapGuard` only | unchanged |
| `test/integration/shutdown.drain.spec.ts` | `OverlapGuard` only | unchanged |

Spec 001's requirement was that recurring work registers and fires, and the promotion job satisfies it
at least as well as the placeholder did. The tests are rewritten to keep that coverage rather than
dropped, so removing the heartbeat does not quietly reduce what the suite proves. The heartbeat's own
source comment already anticipated this: it says it is expected to be replaced, not extended, when real
scheduled work arrives.

## R10. Idempotency fingerprints need no raw-body access

**Decision**: fingerprint the parsed body, canonicalised by ordering object keys and re-serialising,
hashed with SHA-256 from the standard library.

**Why it needed checking**: matching raw bytes would require capturing the body before the JSON parser
runs, which means custom middleware and a second copy of every request in memory.

FR-030a settles the semantics in the caller's favour anyway: two byte-different serialisations of the
same request must compare equal, because clients re-serialise on retry. Once that is the rule, the
parsed body is the correct input and the raw bytes are the wrong one. Canonicalisation must order keys
at every depth, not just the top level, since line items are nested objects.

`crypto.randomUUID` is available on the global object and returns the expected 36-character form, so
correlation identifiers need no dependency either.

## Risks carried into implementation

| Risk | Consequence if unmanaged | Mitigation |
| :--- | :--- | :--- |
| The status filter makes one status dominate the table | A filtered listing degrades to a scan of that status | R4's row-value predicate, asserted by a query-plan test rather than by inspection |
| The touch trigger runs once per claimed row | A large chunk costs twice the writes it appears to | Chunk size is 100 by default, and FR-087 measures what a tick actually promotes |
| Cleanup phase ordering is easy to get wrong again | Every order test fails with a message pointing at the wrong place | Three named lists in the schema barrel, each with the reason for its position |
| A future contributor adds a customer filter to the listing | A silent full scan under an index-shaped API | FR-056a states the refusal and its reason; the query-plan test is the enforcement |
| The exactness check on derived totals is easy to add on write and forget on read | A rounded total returned from a read path | FR-042a states it, and one shared derivation function is the only place a total is computed |
