# Phase 0 Research: Order Entities

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-05

## Method

Every finding below was produced by running the actual toolchain in this repository, not by recalling
documentation. Where a claim could be checked by executing SQL or generating a migration, it was, and
the observed output is quoted. This follows the pattern Spec 001 established after a research
conclusion there turned out to be wrong on inference and right only by accident.

Two probes were used and then deleted:

1. A `better-sqlite3` script against an in-memory database, exercising constraints, triggers,
   generated columns, foreign key restrictions, and changed-row counts.
2. A throwaway Drizzle schema plus config, run through `drizzle-kit generate`, to inspect the SQL
   actually emitted, followed by applying a hand-written trigger migration through Drizzle's
   migrator.

## Verified environment facts

| Fact | Value | How verified |
| :--- | :--- | :--- |
| SQLite version | 3.53.4 | `SELECT sqlite_version()` through the installed driver |
| `recursive_triggers` default | `0` (off) | `PRAGMA recursive_triggers` |
| drizzle-orm | 0.45.2 | package metadata in `node_modules` |
| drizzle-kit | 0.31.10 | package metadata in `node_modules` |
| better-sqlite3 | 13.0.3 | package metadata in `node_modules` |

The SQLite version matters because stored generated columns require 3.31 or newer. 3.53.4 clears it
with room to spare, and the version travels with the driver rather than with the machine, so no
developer can be on an older engine.

## R1: Triggers cannot be expressed in a Drizzle schema

**Decision**: Trigger DDL goes in a migration created by `drizzle-kit generate --custom`.

**Finding**: `drizzle-orm/sqlite-core` exports no trigger construct. Filtering every export name for
anything matching `/trig/i` returns an empty list. `check`, `index`, `uniqueIndex`, `primaryKey`, and
`foreignKey` are all present; triggers are simply absent from the API surface.

**Why it matters**: Constitution Principle IV requires immutability to be enforced by a trigger and
explicitly forbids an application-layer guard. The constitution separately requires Drizzle schema
modules to be the single source of truth. Both cannot hold. This is recorded as the plan's only
Complexity Tracking entry.

**Verified resolution**: `drizzle-kit generate --config=... --custom --name=<name>` produces an empty
`.sql` file, registered in `meta/_journal.json` with its own `idx` and `tag`, printing "Prepared empty
file for your custom SQL migration!". The migration remains a first-class drizzle-kit artifact, so
`db:migrate` applies it and Spec 001's `pendingMigrations()` counts it correctly, since that function
compares journal entries against rows in `__drizzle_migrations`.

**Alternatives considered**: Application-layer enforcement, rejected because Principle IV names it as
the failure mode. A separate migration runner outside Drizzle, rejected because it creates the second
persistence path the constitution forbids. Waiting for upstream trigger support, rejected as
unbounded.

## R2: Multi-statement trigger migrations survive the migrator

**Decision**: Separate each trigger with `--> statement-breakpoint`.

**Finding**: This was the highest-risk unknown, because a trigger body contains semicolons inside
`BEGIN ... END`, and a migrator that split on semicolons would tear the statement in half. It does
not. Drizzle's better-sqlite3 migrator splits on the `--> statement-breakpoint` marker.

Applying a custom migration containing two triggers separated by that marker produced:

```text
triggers created: [{"name":"probe_lines_no_delete"},{"name":"probe_lines_no_update"}]
delete: REFUSED -> undeletable
```

Both triggers landed intact and the delete guard fired.

**Alternatives considered**: Executing trigger SQL from application startup code, rejected because it
would run outside the migration ledger and make the schema state unknowable from the journal.

## R3: drizzle-kit emits every column-level guarantee this model needs

**Decision**: Put constraints, indexes, and the line total in the Drizzle schema. Only triggers leave
it.

**Finding**: A probe schema using `check()`, a composite `index()`, a foreign key with
`onDelete: 'restrict'`, and `generatedAlwaysAs(..., { mode: 'stored' })` generated exactly:

```sql
`line_total_minor` integer GENERATED ALWAYS AS (unit_price_minor * quantity) STORED,
FOREIGN KEY (`order_id`) REFERENCES `probe_orders`(`id`) ON UPDATE no action ON DELETE restrict
CONSTRAINT "probe_status_valid" CHECK("probe_orders"."status" IN ('pending','processing','cancelled'))
CREATE INDEX `probe_orders_created_idx` ON `probe_orders` (`created_at_us`,`id`);
```

All four constructs survive generation. Nothing needs hand-editing except the triggers.

## R4: The line total is a generated column, not a checked column

**Decision**: `line_total_minor` is `GENERATED ALWAYS AS (unit_price_minor * quantity) STORED`.

**Rationale**: FR-017 requires the equality to be guaranteed by the database. A `CHECK` would satisfy
that by rejecting wrong values; a generated column satisfies it by making a wrong value
unrepresentable. The second is strictly stronger and removes the field from the write path entirely,
so no caller can supply it and no caller can supply it wrongly. Verified: inserting a price of 500 and
quantity of 3 produced a stored total of 1500 without the insert naming the column.

**Alternatives considered**: A `CHECK (line_total_minor = unit_price_minor * quantity)` with the value
supplied by the write path. Rejected as weaker for no gain. Deriving the line total on read like the
order total. Rejected because unlike the order total it is a single-row expression, so the database
can hold it, and FR-017 asks the database to.

**Caveat for later specs**: SQLite cannot add a `STORED` generated column with `ALTER TABLE`, only a
`VIRTUAL` one. Changing this column later means a table rebuild migration.

## R5: Immutability triggers behave as Principle IV describes

**Decision**: `BEFORE UPDATE` and `BEFORE DELETE` triggers on line items, each calling
`RAISE(ABORT, ...)`.

**Verified**:

```text
update line item price: REFUSED (order line items are immutable)
delete line item:       REFUSED (order line items cannot be deleted)
delete order:           REFUSED (FOREIGN KEY constraint failed)
delete customer:        REFUSED (FOREIGN KEY constraint failed)
update created_at:      REFUSED (created_at is immutable)
```

The order deletion refusal comes from the foreign key rather than from a trigger, which confirms
FR-025b: no separate deletion rule on `orders` is needed, because the restriction already holds
through the line item that cannot be removed.

The frozen creation timestamp uses `BEFORE UPDATE OF created_at_us ... WHEN NEW.created_at_us <>
OLD.created_at_us`, so it fires only on an actual change rather than on every update touching the row.

## R6: Timestamp maintenance does not corrupt the changed-row count

**Decision**: An `AFTER UPDATE` trigger on `orders` sets `updated_at_us`.

**Why this needed proving**: FR-034b exists because Constitution Principle II decides the HTTP 409
response from the driver's changed-row count. A trigger that inflated that count would turn a lost
race into a reported success, which is the exact failure Principle II is written to prevent.

**Verified**:

```text
conditional update .changes (expect 1): 1
updated_at after trigger (expect 2000): 2000
same update again .changes (expect 0):  0
updated_at after miss (expect 2000):    2000
```

The count reflects only the caller's own statement. SQLite's changed-row counter excludes rows
modified by triggers, and the second, non-matching update correctly reported zero and left the
timestamp alone.

**Related finding**: `PRAGMA recursive_triggers` defaults to `0`, so an `AFTER UPDATE` trigger that
updates the same table does not re-enter itself. The single increment observed above confirms it. This
is a default the model now depends on, so it is worth an assertion in the test suite rather than an
assumption, in the same spirit as Spec 001's existing pragma test.

## R7: The monetary ceiling is enforced by two clauses, for two different arrival paths

**Decision**: `CHECK (typeof(col) = 'integer' AND col >= 0 AND col <= 9007199254740991)`.

**Finding**: The two clauses are not redundant, and which one fires depends on how the value arrives.

| Input | Path | Refused by |
| :--- | :--- | :--- |
| `1.5` from the driver | JavaScript number, non-integer | `typeof` clause |
| `9007199254740992` from the driver | JavaScript number above the safe range, sent as a float | `typeof` clause |
| `9007199254740992n` as BigInt | genuine integer, too large | range clause |
| `9007199254740992` as a SQL literal | genuine integer, too large | range clause |
| `9007199254740991` either way | at the ceiling | accepted, stored exactly |

**Why this matters for testing**: a test that only pushes an oversized plain number through the driver
proves the `typeof` clause and never touches the range clause. FR-042 requires each guarantee to have
a test that fails when the guarantee is removed, so the boundary tests must include a BigInt or a raw
SQL literal, otherwise deleting the range clause would leave the suite green.

`typeof` also has to come first in the conjunction for a readable failure, since it is the clause that
catches the common case.

## R8: Test isolation splits by table

**Decision**: `DELETE FROM` for tables that permit it, a rebuild for the two that do not.

**Rationale**: Constitution v2.1.0 requires `DELETE FROM` wherever the table permits row deletion, and
a rebuild only where deletion is refused. `harness_probe` from Spec 001, plus the `customers` and
`products` placeholders, all still take `DELETE FROM`. Only `orders` and `order_line_items` refuse it,
because of R5.

**Consequence**: `ALL_TABLE_NAMES` can no longer be a flat list that `per-test.ts` iterates, because
the two groups need different treatment. It becomes two lists, and the harness applies the right
mechanism to each. This is the one place Spec 001's test infrastructure changes.

**Resolved during implementation: per test.** The question was whether to rebuild per test file or
per test, trading isolation strength against suite time. It was settled by measurement rather than by
argument.

One rebuild drops two tables and replays nine captured statements. Timed over 200 iterations against
a migrated database, that costs **0.569 ms**.

| Granularity | Rebuilds per run | Cost | Isolation |
| :--- | :--- | :--- | :--- |
| Per test | 116 | ~66 ms | Every test starts empty |
| Per test file | 30 | ~17 ms | Tests share state within a file |

The difference is **49 ms across a suite that runs in 5.96 s**, under one percent, against an
advisory budget of two minutes. There is no trade to make at that scale, so the stronger option wins
on its merits: per test, which is what Spec 001's SC-005 already promises and what the weaker option
would have quietly walked back.

Had the numbers gone the other way, the honest move would have been per file plus an explicit note
that SC-005 no longer holds within a file. They did not, so it does not arise.

## R9: A JavaScript number interpolated into a Drizzle `sql` template becomes a bound parameter

**Found during implementation, not Phase 0.**

Writing the monetary ceiling as ``sql`... <= ${MAX_MINOR_UNITS}` `` produced this in the generated
migration:

```sql
CHECK(typeof("products"."unit_price_minor") = 'integer' AND ... <= ?)
```

Drizzle treats an interpolated value as a bound parameter, which is correct for a query and wrong for
DDL: a `CHECK` constraint cannot carry a placeholder. The constraint would have been meaningless, and
nothing at generation time complains.

**Resolution**: `${sql.raw(String(MAX_MINOR_UNITS))}`, which emits the literal `9007199254740991`.

**Why Phase 0 missed it**: R3's probe used a hard-coded literal inside the template rather than an
interpolated constant, so it exercised the path that works. The lesson generalises past this feature:
generated DDL has to be read, not assumed, and any future `check()` carrying a constant needs the same
treatment.

## R10: SQLite's clock resolves to milliseconds, which the touch trigger has to account for

**Found during implementation, not Phase 0.**

R6 established that an `AFTER UPDATE` trigger can maintain `updated_at_us` without disturbing the
changed-row count. It did not establish what the trigger should read the time *from*.

Two problems surfaced:

- `julianday('now')` carries float rounding artifacts, landing roughly 9 microseconds off a value
  computed from `unixepoch`. It does not overflow, contrary to an initial concern: the product lands
  near 1.79e15, well inside the exact range.
- Both `julianday` and `unixepoch('now','subsec')` resolve to milliseconds. Two reads taken back to
  back return identical values. If the write path sets `created_at_us` with true microsecond
  precision, a bare clock reading in the trigger can land *below* it, tripping
  `orders_updated_at_us_valid` and aborting a legitimate status change.

**Resolution**:

```sql
SET updated_at_us = MAX(
  CAST(unixepoch('now', 'subsec') * 1000000 AS INTEGER),
  OLD.updated_at_us + 1
)
```

The `MAX` makes the column monotonic, keeps it at or above `created_at_us` by construction, and makes
every update advance it strictly even when two land inside the same millisecond. Verified: changed-row
counts of 1, 1, 0 across a matching update, a second matching update, and a non-matching one, with
`updated_at_us` advancing by the one-microsecond tiebreak when the clock had not moved.

**Consequence for the spec**: this is *stronger* than the spec requires. The edge case in spec.md says
two updates inside one microsecond "may" leave the timestamp identical. They never do. Permitting
identical values and never producing them is compatible, so no spec change is needed.

## Open questions

None. R8's rebuild granularity was the only one, and it was settled by measurement during
implementation.

## Risks

| Risk | Status | Note |
| :--- | :--- | :--- |
| Triggers torn apart by naive statement splitting | **Void** | R2 verified the migrator uses `--> statement-breakpoint` |
| Generated column unsupported by the engine or the generator | **Void** | R3 and R4 verified both |
| Timestamp trigger corrupting the 409 decision | **Void** | R6 verified the count is unaffected |
| Trigger recursion on the same table | **Void** | Default `recursive_triggers = 0`, confirmed |
| A boundary test that proves only one of the two ceiling clauses | **Live** | R7. Mitigated by requiring a BigInt or SQL literal case |
| Table rebuild eroding the advisory verification budget | **Void** | Measured at 0.569 ms per rebuild, 66 ms across the run against a 5.96 s suite |
| Drizzle schema modules not being the full source of truth | **Live, accepted** | Recorded in the plan's Complexity Tracking. A reviewer reading only the schema files will not see the triggers |
