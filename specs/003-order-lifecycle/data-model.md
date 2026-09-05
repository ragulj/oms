# Data Model: Order Lifecycle and Processing

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contract**: [contracts/http-api.md](contracts/http-api.md)

Spec 002 owns the Order and Order Line Item tables. This document does not restate them. It records
the one table this feature adds, the two structures it defines that are never persisted, and the
precise way it reads and writes what already exists.

## New persisted entity

### `idempotency_records`

One row per creation request that carried an idempotency key and succeeded.

| Column | Type | Constraint | Why |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | primary key, autoincrement | surrogate key, consistent with every other table |
| `idempotency_key` | TEXT | NOT NULL, **UNIQUE** | FR-034. This constraint, and not any application check, is what makes a duplicate order impossible rather than unlikely |
| `request_fingerprint` | TEXT | NOT NULL | FR-030a. SHA-256 over the canonicalised request body, so a replay carrying a different request is detectable as a conflict rather than answered with the wrong order |
| `order_id` | INTEGER | NOT NULL, FK to `orders.id`, ON DELETE RESTRICT | what a replay returns. Spec 002 guarantee G9 means this reference can never dangle |
| `created_at_us` | INTEGER | NOT NULL, CHECK integer and > 0 | FR-035. Present so a later specification can expire records without a schema change |

**No index beyond the primary key and the unique constraint.** The unique constraint on
`idempotency_key` creates the index the only lookup needs. `order_id` is deliberately unindexed, for
the same reason Spec 002 left its foreign key columns unindexed under FR-039a: nothing queries in that
direction, and an index is a write-time cost paid on every insert.

**The table is fully mutable and fully deletable.** It holds no financial history, so Constitution
Principle IV does not reach it and the immutability triggers do not apply. That matters for test
isolation, and is why it is cleared by deletion rather than by rebuild.

## Test isolation, and the ordering that is not optional

Adding this table changes the shape of per-test cleanup, because its foreign key points at a table the
harness destroys and recreates. Research R6 measured what happens if the order is wrong: `DROP TABLE
orders` is **refused** while an idempotency row references it, and every test touching an order fails
with a foreign key error raised during a table drop.

Cleanup therefore has three ordered phases, and the schema barrel names them so the order is data
rather than a comment someone can drift from:

| Phase | Tables | Mechanism | Why it must be here |
| :--- | :--- | :--- | :--- |
| 1 | `idempotency_records` | `DELETE FROM` | its rows reference orders, and the drop in phase 2 is refused while they exist |
| 2 | `order_line_items`, `orders` | drop and recreate | Principle IV's triggers refuse row deletion; child before parent on the way down |
| 3 | `harness_probe`, `products`, `customers` | `DELETE FROM` | phase 2 released the foreign keys into products and customers, so deletion now succeeds |

Constitution Principle VI requires `DELETE FROM` wherever the table permits it and a rebuild only
where deletion is refused. Two of the three phases use the default mechanism; only the middle one
needs the heavier alternative.

## Structures defined but never persisted

### Order page cursor

An opaque token marking where a listing traversal continues. It carries the full microsecond
`created_at_us` and the `id` tiebreaker, and nothing else.

- Encoded as base64url over a compact representation, so callers treat it as opaque and no client
  builds one by hand.
- Decoded defensively: a token that is not valid base64url, does not parse, or does not yield two
  positive integers is rejected under FR-050, never silently treated as an absent cursor.
- **Never round-tripped through a date type.** Principle V names this specifically, and FR-009 removes
  the temptation at the source by refusing to expose any truncating rendering of the timestamp in a
  response.

The predicate it feeds is a row-value comparison, `(created_at_us, id) < (:ts, :id)`, ordered
`created_at_us DESC, id DESC`. Research R4 measured why this beats the logically identical OR form
once a status filter is applied: the OR form leaves the timestamp unconstrained and walks the whole
status.

### Transition graph

The complete set of legal status changes, held in one module, as a mapping from source status to the
set of reachable targets:

```text
pending    -> { processing, cancelled }
processing -> { }
cancelled  -> { }
```

Three properties follow, and each is a requirement rather than an observation:

- Every ordered pair not listed is illegal, including all three self-transitions (FR-059).
- The module answers the inverse question too, "which sources permit this target", because that is
  what a caller needs to build its conditional predicate without restating the rules (FR-060).
- `processing` and `cancelled` are terminal within this scope. The status set carries no completion
  value, so there is nowhere for a processing order to go.

The graph is asserted exhaustively over all nine ordered pairs (FR-063), so adding a status without
declaring its edges fails a test rather than passing silently.

## How existing entities are used

### Writing an order

One transaction, discharging Spec 002 contract obligation O1:

1. Resolve the customer. Absent, and the request is rejected before anything is written.
2. Resolve every referenced product in one query, capturing each one's current `name` and
   `unit_price_minor`. Any unresolved product rejects the whole request (FR-017).
3. Insert the order with `status = 'pending'` and one server-derived microsecond value written to both
   `created_at_us` and `updated_at_us` (FR-022).
4. Insert every line, carrying the captured description and price. `line_total_minor` is not supplied:
   Spec 002 made it a stored generated column, so it is unrepresentable as a write.
5. Read the stored line totals back and derive the order total. If it is not exactly representable,
   **abort the transaction** (FR-025), so an order whose total cannot be stated exactly never exists.
6. If the request carried an idempotency key, insert the record in this same transaction (FR-031).

### Reading an order, and reading a page

Retrieval is one order query plus one line-item query. Listing is the same two queries with the first
one paged, which is Principle V's two-phase shape. The second query is `order_id IN (...)` over
exactly the identifiers the first returned, served by `order_line_items_order_id_idx`, and bounded
because FR-015 caps lines per order at 100 and FR-046 caps page size at 100.

The total is derived on both paths by the same function, which is the only place in the system that
sums line totals. FR-042a requires the exactness check on read as well as write, and a single
derivation point is what makes that true by construction rather than by discipline.

### Changing a status

Every status change, whether it came from a request or from the scheduled job, is the conditional
update Principle II mandates, with the source statuses supplied by the state machine:

```sql
UPDATE orders SET status = :next WHERE id = :id AND status IN (:permitted_sources);
```

`updated_at_us` is absent from the SET clause on purpose. Spec 002 guarantee G11 has a trigger
maintain it, and its R6 confirmed the trigger does not inflate the changed-row count that Principle II
uses to decide the outcome. Research R3 extended that confirmation to the multi-row case the
background claim produces.

### Claiming a chunk of backlog

The background job's statement is the same conditional update with a bounded subquery selecting the
identifiers, which is the shape Constitution Principle III writes out literally:

```sql
UPDATE orders SET status = 'processing'
WHERE id IN (SELECT id FROM orders WHERE status = 'pending'
             ORDER BY created_at_us, id LIMIT :chunk)
  AND status = 'pending';
```

The outer `status = 'pending'` is not redundant with the subquery's. It is what excludes an order that
was cancelled in the interval between the subquery choosing it and the update reaching it, which is
FR-090, and it is why the exclusion is a property of the statement rather than of a filter written in
application code.

## Configuration added

| Setting | Type | Default | Constraint | Requirement |
| :--- | :--- | :--- | :--- | :--- |
| `ORDER_PROMOTION_CHUNK_SIZE` | integer | 100 | positive | FR-083 |
| `ORDER_PROMOTION_MAX_ITERATIONS` | integer | 10 | positive | FR-084 |

`SCHEDULER_INTERVAL_MS` already exists and already defaults to 300,000, which is the five-minute
cadence FR-080 requires. It is reused rather than duplicated.

Both new settings go through the existing zod configuration schema, so a zero or negative value stops
the process at startup with the offending setting named, exactly as every other invalid setting
already does. Their product, 1,000 orders per tick at the defaults, is the blocking-time budget
Principle III is actually about, and is stated in the specification as such rather than as a
throughput target.
