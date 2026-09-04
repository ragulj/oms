# Phase 1 Data Model: Order Entities

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Column names are snake_case as stored; the Drizzle property name follows in parentheses where it
differs. Every constraint below traces to a numbered requirement, and every requirement that this
model can hold is held here.

## `customers` (placeholder)

Exists only so the order's foreign key points at something real. FR-001a marks it for replacement,
not extension, by whatever specification eventually owns customers.

| Column | Type | Constraints | Requirement |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | FR-001a |
| `name` | TEXT | NOT NULL | FR-001a |

No timestamps, no status, no soft-delete flag, no index beyond the primary key.

## `products` (placeholder)

| Column | Type | Constraints | Requirement |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | FR-001a |
| `name` | TEXT | NOT NULL | FR-001a |
| `unit_price_minor` | INTEGER | NOT NULL, `typeof = 'integer'`, `>= 0`, `<= 9007199254740991` | FR-001a, FR-011, FR-019 |

The current price is here for one reason: it makes FR-014 demonstrable. Changing it and observing
that a stored line item does not follow is the test that proves price capture works. Without it the
guarantee could only be asserted.

## `orders`

| Column | Type | Constraints | Requirement |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | FR-002, FR-004 |
| `customer_id` | INTEGER | NOT NULL, FK to `customers.id` ON DELETE RESTRICT | FR-009, FR-010, FR-010a |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK IN (`'pending'`, `'processing'`, `'cancelled'`) | FR-026, FR-027, FR-028 |
| `created_at_us` | INTEGER | NOT NULL, `typeof = 'integer'`, `> 0` | FR-031, FR-032, FR-034 |
| `updated_at_us` | INTEGER | NOT NULL, `typeof = 'integer'`, `>= created_at_us` | FR-031, FR-033, FR-034 |

**No total column.** FR-018 makes the order total a derivation over line totals.

### Triggers

| Trigger | Timing | Effect | Requirement |
| :--- | :--- | :--- | :--- |
| `orders_created_at_frozen` | BEFORE UPDATE OF `created_at_us` WHEN changed | `RAISE(ABORT)` | FR-024 |
| `orders_touch_updated_at` | AFTER UPDATE | sets `updated_at_us` to now | FR-034a |

The touch trigger must not inflate the caller's changed-row count, per FR-034b. R6 verified it does
not, and R6 also records that this depends on `recursive_triggers` staying off, which is the SQLite
default and is asserted in the suite rather than assumed.

### Indexes

| Index | Columns | Serves | Requirement |
| :--- | :--- | :--- | :--- |
| `orders_created_at_id_idx` | (`created_at_us`, `id`) | keyset page, with the primary key as the tiebreaker that makes the sort total | FR-036 |
| `orders_status_created_at_id_idx` | (`status`, `created_at_us`, `id`) | the bounded backlog claim: oldest rows in a given status under a limit | FR-037 |

`customer_id` is deliberately not indexed, per FR-039a. The deletion restriction on `customers`
therefore scans `orders`, which is accepted because deleting a placeholder customer is not a committed
access pattern.

## `order_line_items`

| Column | Type | Constraints | Requirement |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | FR-003, FR-004 |
| `order_id` | INTEGER | NOT NULL, FK to `orders.id` ON DELETE RESTRICT | FR-005, FR-006, FR-007 |
| `product_id` | INTEGER | NOT NULL, FK to `products.id` ON DELETE RESTRICT | FR-009, FR-010, FR-010a |
| `product_description` | TEXT | NOT NULL | FR-025 |
| `unit_price_minor` | INTEGER | NOT NULL, `typeof = 'integer'`, `>= 0`, `<= 9007199254740991` | FR-011, FR-013, FR-014, FR-015, FR-019 |
| `quantity` | INTEGER | NOT NULL, `typeof = 'integer'`, `>= 1` | FR-016 |
| `line_total_minor` | INTEGER | GENERATED ALWAYS AS (`unit_price_minor` * `quantity`) STORED | FR-017 |

No `created_at_us`, per FR-035. The row is written inside its order's transaction and is immutable
after, so the order's creation timestamp is its creation timestamp and a second copy could only
disagree.

No uniqueness across (`order_id`, `product_id`), per FR-010b. The same product may appear on several
lines.

### Triggers

| Trigger | Timing | Effect | Requirement |
| :--- | :--- | :--- | :--- |
| `order_line_items_immutable` | BEFORE UPDATE | `RAISE(ABORT)` | FR-021, FR-022, FR-023 |
| `order_line_items_undeletable` | BEFORE DELETE | `RAISE(ABORT)` | FR-025a |

A blanket BEFORE UPDATE guard covers FR-021 through FR-023 in one statement, because every column on
this table is immutable. There is no column a legitimate caller may change, so there is nothing for a
narrower trigger to permit.

### Indexes

| Index | Columns | Serves | Requirement |
| :--- | :--- | :--- | :--- |
| `order_line_items_order_id_idx` | (`order_id`) | second query of the two-phase read, fetching lines for a page of order ids | FR-038 |

SQLite appends the rowid to every index entry, so an index on (`order_id`) already orders by `id`
within an order. That covers the deterministic line ordering in User Story 1 scenario 5 without a
second index, and it is why no explicit line number column exists.

`product_id` is not indexed, per FR-039a.

## Relationships

```text
customers (1) ────< (N) orders (1) ────< (N) order_line_items >──── (1) products
                              RESTRICT              RESTRICT
```

Every arrow is `ON DELETE RESTRICT`. Nothing in this model cascades, because a cascade would let one
statement remove financial history as a side effect of a catalog edit.

**Permanence, as a consequence rather than a rule** (FR-025b): an order always has at least one line
item, that line item cannot be deleted, and the order cannot be deleted while a line item references
it. So orders are permanent. No separate guard on `orders` exists, and FR-025b forbids adding one.

## Invariants the schema cannot hold

Two, both stated where they are enforced rather than pretended away.

| Invariant | Why the schema cannot hold it | Where it is enforced | Requirement |
| :--- | :--- | :--- | :--- |
| An order has at least one line item | The order row must exist before any line can reference it, and SQLite has no deferred constraints | The write path, inside the transaction that creates the order | FR-008 |
| The derived order total stays exactly representable | It is a sum whose term count is unknown, and two conforming line totals can exceed the ceiling between them | The derivation, which must fail loudly rather than return a rounded value | FR-019a |

## Status values

`pending` (default on insert) → `processing` → `cancelled` are the three permitted values. This model
fixes the set and the default only. **No ordering or precedence is encoded** (FR-030); which
transitions are legal belongs to the state machine in a later specification, per Constitution
Principle I.
