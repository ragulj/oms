# Persistence Contract: Order Entities

**Feature**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

This feature exposes no HTTP surface, no CLI, and no public API. Its interface is the set of
guarantees a later specification may build on without re-checking, and the small number of things it
deliberately does not guarantee. That is what this document records.

It is an internal contract between Spec 002 and Specs 003 and later. Nothing outside this repository
consumes it.

## What the database guarantees

A consumer may rely on all of the following without defensive checks. Each is enforced by the
database, so a violation is an exception at the call site rather than bad data read back later.

| # | Guarantee | Enforced by |
| :--- | :--- | :--- |
| G1 | Every monetary value read is a whole number of minor units in `[0, 9007199254740991]` | CHECK constraints |
| G2 | `line_total_minor` equals `unit_price_minor * quantity`, always | stored generated column |
| G3 | Every quantity is at least 1 | CHECK constraint |
| G4 | Every order status is one of `pending`, `processing`, `cancelled` | CHECK constraint |
| G5 | Every timestamp is a positive integer count of microseconds since the Unix epoch | CHECK constraints |
| G6 | An order's `updated_at_us` is never earlier than its `created_at_us` | CHECK constraint |
| G7 | Every line item belongs to an existing order; every order to an existing customer; every line to an existing product | foreign keys |
| G8 | A stored line item never changes and never disappears | BEFORE UPDATE and BEFORE DELETE triggers |
| G9 | A stored order never disappears | G8 plus ON DELETE RESTRICT |
| G10 | An order's `created_at_us` never changes | BEFORE UPDATE trigger |
| G11 | An order's `updated_at_us` advances on every update to the row, with no caller action | AFTER UPDATE trigger |

## What consumers must do themselves

| # | Obligation | Why the database cannot | Requirement |
| :--- | :--- | :--- | :--- |
| O1 | Create an order and at least one line item in the same transaction, and never expose an order with no lines | The order row must exist before a line can reference it, and SQLite has no deferred constraints | FR-008 |
| O2 | Compute the order total by summing line totals, and fail loudly if the sum exceeds the G1 ceiling rather than returning a rounded value | The sum spans rows and has an unknown term count, so no column constraint bounds it | FR-018, FR-019a |
| O3 | Decide which status transitions are legal | This model records the current value only and encodes no ordering | FR-030 |

## The three query shapes this model is indexed for

Any other access pattern will work and may scan. These three will not scan, and are the ones the
constitution commits the system to.

**Keyset page of orders** (Principle V, phase one). Ordered by `created_at_us` with `id` as the
tiebreaker that makes the sort total. Served by `orders_created_at_id_idx`. A cursor must carry both
values and must not round-trip the timestamp through a JavaScript `Date`, which truncates to
milliseconds.

**Bounded backlog claim** (Principle III). Oldest orders in a given status, under a row limit, to be
promoted in chunks. Served by `orders_status_created_at_id_idx`.

**Line items for a page of orders** (Principle V, phase two). All lines whose `order_id` is in a given
set. Served by `order_line_items_order_id_idx`, which also yields deterministic within-order ordering
because SQLite appends the rowid to index entries.

## Conditional status update

The shape Principle II requires, and the one this model is built to support:

```sql
UPDATE orders SET status = :next WHERE id = :id AND status = :expected;
```

The changed-row count is **1** when the expected status matched and **0** when it did not. There is no
third outcome. The `updated_at_us` trigger does not affect this count, which was verified rather than
assumed (see [research.md](../research.md) R6). A count of 0 means the order moved underneath the
caller and must surface as HTTP 409, never 404 and never a silent retry into success.

## Stability

G1 through G11 are stable. A later specification may add tables, columns, and indexes, but weakening
any guarantee above requires amending the constitution first, because each one traces to a principle
rather than to a local preference.

Two things here are explicitly **not** stable, and no consumer should depend on them:

- The `customers` and `products` tables. They are placeholders, and FR-001a says the specification
  that owns those entities replaces them rather than extending them. Only their `id` columns, as
  foreign key targets, will survive.
- Order identifiers are sequential integers, which is externally enumerable. Spec 002's Assumptions
  accept that under the current unauthenticated local scope and name an opaque public identifier as
  the change to make if that scope widens.
