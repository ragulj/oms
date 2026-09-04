# Quickstart: Validating Order Entities

**Feature**: [spec.md](spec.md) | **Data model**: [data-model.md](data-model.md) | **Contract**: [contracts/persistence.md](contracts/persistence.md)

How to prove this feature works once it is built. Every scenario runs against a real database file,
per Constitution Principle VI. No scenario needs an HTTP surface, a service layer, or a scheduler,
because this feature has none.

## Prerequisites

Node 22 or newer, and the repository already set up per Spec 001. Nothing new to install: this
feature adds no dependency.

## Setup

1. Install dependencies and configure the environment, if you have not already:

   ```bash
   npm install
   ```

2. Generate the migrations from the schema. This produces two files, one for the tables and one for
   the triggers:

   ```bash
   npm run db:generate
   ```

3. Create the trigger migration as a registered custom file, then write the trigger DDL into it,
   separating each trigger with a `--> statement-breakpoint` line:

   ```bash
   npx drizzle-kit generate --custom --name=order_immutability_triggers
   ```

4. Apply everything:

   ```bash
   npm run db:migrate
   ```

5. Run the full suite:

   ```bash
   npm test
   ```

Expected: every test passes, and the run reports a non-zero test count. A zero-test run is a build
failure by design.

## Scenario 1: An order round-trips faithfully (User Story 1)

Insert a customer, a product, an order, and several line items in one transaction. Read them back by
primary key.

**Expected**: every field returns the value and type it was given. The line items come back in the
same order on every read. Inserting an order that names a customer which does not exist is refused,
as is a line item naming a missing order or product.

## Scenario 2: Money stays exact (User Story 2)

Write prices at `0`, at `1`, at `9007199254740991`, and above it.

**Expected**: the first three are accepted and read back byte-identical. The fourth is refused. The
line total equals price times quantity with no fractional part, and it was never supplied by the
insert, because it is a generated column.

**Do not skip this**: the ceiling is enforced by two CHECK clauses that catch different arrival paths.
A plain oversized JavaScript number is refused by the `typeof` clause, never reaching the range
clause. To exercise the range clause you must pass a BigInt or use a raw SQL literal. A boundary test
that only uses plain numbers stays green if someone deletes the range clause. See
[research.md](research.md) R7.

## Scenario 3: History cannot be rewritten (User Story 3)

Against a stored line item, attempt in turn: updating the price, updating the quantity, updating the
product reference, deleting the row, and deleting its order.

**Expected**: all five are refused by the database. Then change the product's catalog price and name,
and re-read the line item.

**Expected**: it still reports the price and description captured when the order was placed. This is
the check that makes price capture meaningful rather than merely asserted.

## Scenario 4: Status is closed and the conditional update is decidable (User Story 4)

Attempt to store `shipped`. Then run the conditional update from
[contracts/persistence.md](contracts/persistence.md), twice.

**Expected**: `shipped` is refused. The first update reports exactly 1 changed row, the second exactly
0. After the first, `updated_at_us` has advanced and `created_at_us` has not, even though the update
statement named neither timestamp. After the second, no timestamp moved.

That changed-row count is the single most important assertion in this feature. Principle II decides
the HTTP 409 response from it, so a trigger that inflated it would turn a lost race into a reported
success.

## Scenario 5: The committed queries do not scan (User Story 5)

Populate at least 10,000 orders with line items. Take the query plan for each of the three shapes in
the contract.

**Expected**: each plan names an index and none reports a full scan of `orders` or
`order_line_items`. Then page the whole set with a keyset cursor, including orders deliberately
created within the same microsecond.

**Expected**: every order appears exactly once. No duplicates, no omissions.

## Scenario 6: Test isolation still holds

Run the suite twice in a row, then run a single test file alone.

**Expected**: identical results all three times, and the file alone produces the same outcome it does
inside the full suite.

This is worth checking explicitly for this feature, because isolation now works two different ways.
`orders` and `order_line_items` refuse row deletion, so they are rebuilt between tests, while every
other table including `harness_probe` is still cleared with `DELETE FROM`, which Constitution
Principle VI requires wherever it still works.

## What to measure while you are here

[research.md](research.md) R8 leaves one decision open: whether the rebuild runs per test file or per
test. Per test is the stronger guarantee; per file is faster. Time both against the advisory
two-minute verification budget in Spec 001's SC-003, then choose and record the number rather than
guessing.
