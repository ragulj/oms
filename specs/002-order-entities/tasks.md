---

description: "Task list for Order Entities"
---

# Tasks: Order Entities

**Input**: Design documents from `/specs/002-order-entities/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/persistence.md](contracts/persistence.md)

**Tests**: Test tasks are **mandatory** for this feature, not optional. FR-042 requires every
constraint, trigger, and index to be covered by a test that exercises the failure mode it prevents,
and Constitution Principle VI requires those tests to run against a real database.

**Organization**: Tasks are grouped by user story so each family of guarantees can be verified
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 through US5)
- File paths are exact

## Path Conventions

Single project. Schema under `src/database/schema/`, migrations under `drizzle/`, tests under
`test/`, per the Structure Decision in [plan.md](plan.md).

## Why the schema is built once, in Phase 2

These are brand new tables. Splitting their constraints across five migrations, one per user story,
would make SQLite rebuild each table five times for no benefit, and would leave a migration history
that describes the order the tests were written in rather than the shape of the data.

So Phase 2 builds the complete schema, and each user story phase verifies one family of guarantees.
The red phase that test-first development exists to provide is preserved by an explicit **mutation
check** at the end of each story: remove the guarantee, confirm the suite goes red, restore it. That
is not a substitute for TDD discipline, it is what SC-010 literally requires ("Deleting any single one
from the schema turns the suite red"), and it proves more than writing the test first does, because
it proves the test is still load-bearing after the code exists.

---

## Phase 1: Setup

**Purpose**: Create the files the rest of the work fills in

- [X] T001 [P] Create empty schema module files `src/database/schema/customers.ts`, `src/database/schema/products.ts`, `src/database/schema/orders.ts`, and `src/database/schema/order-line-items.ts`
- [X] T002 [P] Create the test directories `test/integration/orders/` and `test/support/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The complete schema, both migrations, and the test isolation split. No user story can be
verified until this is done, because every story reads the same tables.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Schema modules

- [X] T003 [P] Define the `customers` placeholder table (`id` autoincrement primary key, `name` text not null, nothing else) in `src/database/schema/customers.ts` per data-model.md
- [X] T004 [P] Define the `products` placeholder table (`id`, `name`, `unit_price_minor` with the `typeof`/range check) in `src/database/schema/products.ts` per data-model.md
- [X] T005 Define the `orders` table in `src/database/schema/orders.ts`: `id`, `customer_id` FK with `onDelete: 'restrict'`, `status` text defaulting to `'pending'` with a check restricting it to the three permitted values, `created_at_us` and `updated_at_us` integer checks, plus the two composite indexes `orders_created_at_id_idx` and `orders_status_created_at_id_idx`
- [X] T006 Define the `order_line_items` table in `src/database/schema/order-line-items.ts`: `id`, `order_id` and `product_id` FKs both `onDelete: 'restrict'`, `product_description`, `unit_price_minor` and `quantity` checks, `line_total_minor` as `generatedAlwaysAs(sql\`unit_price_minor * quantity\`, { mode: 'stored' })`, and the `order_line_items_order_id_idx` index. Deliberately no unique constraint across (`order_id`, `product_id`), per FR-010b
- [X] T007 Update `src/database/schema/index.ts` to re-export all four tables and replace the flat `ALL_TABLE_NAMES` with two exported lists: one for tables cleared by row deletion (`harness_probe`, `customers`, `products`) and one for tables that must be rebuilt (`orders`, `order_line_items`), per research.md R8

### Migrations

- [X] T008 Generate the table migration with `npm run db:generate` and commit the emitted file under `drizzle/`
- [X] T009 Create the registered trigger migration with `npx drizzle-kit generate --custom --name=order_immutability_triggers`
- [X] T010 Write the four triggers into the generated custom migration file, each separated by a `--> statement-breakpoint` line as research.md R2 requires: `order_line_items_immutable` (BEFORE UPDATE), `order_line_items_undeletable` (BEFORE DELETE), `orders_created_at_frozen` (BEFORE UPDATE OF `created_at_us` WHEN changed), and `orders_touch_updated_at` (AFTER UPDATE)
- [X] T011 Apply everything with `npm run db:migrate`, then confirm all four tables, three indexes, and four triggers exist by querying `sqlite_master`

### Test isolation

- [X] T012 Add `test/setup/rebuild.ts` that drops and recreates `orders` and `order_line_items` with their constraints, indexes, and triggers, for use where row deletion is refused
- [X] T013 Update `test/setup/per-test.ts` to apply `DELETE FROM` to the deletable list and the rebuild to the undeletable list, keeping `DELETE FROM` mandatory wherever it still works per FR-025d and Constitution Principle VI
- [X] T014 Add `test/integration/orders/engine-assumptions.spec.ts` asserting `PRAGMA recursive_triggers` is `0` and `sqlite_version()` is at least 3.31, since the model depends on both (research.md R6 for trigger recursion, R4 for stored generated columns)

**Checkpoint**: Schema exists, migrations apply cleanly, tests can isolate. User story verification can begin.

---

## Phase 3: User Story 1 - Record an order and read back exactly what was written (Priority: P1) 🎯 MVP

**Goal**: Prove a round trip is faithful and that required references are enforced. Every other story
is a statement about stored data, so none of them mean anything until this holds.

**Independent Test**: Insert one order with several line items, read them back by primary key, and
compare every column against what was supplied.

- [X] T015 [US1] Add a fixture builder in `test/support/order-fixtures.ts` that inserts a customer, a product, an order, and N line items in one transaction, returning their ids
- [X] T016 [P] [US1] Add `test/integration/orders/round-trip.spec.ts` asserting every stored field returns with the same value and type it was given (US1 scenarios 1 and 2)
- [X] T017 [P] [US1] Add `test/integration/orders/required-fields.spec.ts` asserting an order or line item missing a required field is rejected rather than defaulted (US1 scenario 2)
- [X] T018 [P] [US1] Add `test/integration/orders/foreign-keys.spec.ts` asserting a line item naming a missing order, an order naming a missing customer, and a line item naming a missing product are each rejected (US1 scenarios 3 and 4)
- [X] T019 [US1] Extend `round-trip.spec.ts` to assert line items return in a deterministic order identical on every read, and that the order total equals the sum of line totals with no total stored on the order (US1 scenarios 5 and 6)

**Checkpoint**: US1 is independently verifiable. This is the MVP.

---

## Phase 4: User Story 2 - Money stays exact (Priority: P2)

**Goal**: Prove no monetary value is ever coerced, rounded, or read back changed.

**Independent Test**: Write values at and beyond the permitted boundaries and assert exact integer
equality or rejection.

- [X] T020 [P] [US2] Add `test/integration/orders/money-boundaries.spec.ts` asserting prices of `0`, `1`, and `9007199254740991` are accepted and read back exactly (US2 scenarios 1 and 4)
- [X] T021 [US2] Add rejection cases for fractional values passed through the driver to `money-boundaries.spec.ts` (US2 scenario 2)
- [X] T022 [US2] Add over-ceiling rejection cases to `money-boundaries.spec.ts` using **both** a `BigInt` and a raw SQL literal. A plain oversized JavaScript number is refused by the `typeof` clause and never reaches the range clause, so a test using only plain numbers would stay green if the range clause were deleted (research.md R7)
- [X] T023 [P] [US2] Add `test/integration/orders/line-total.spec.ts` asserting the generated line total equals price times quantity, and that an insert cannot supply the column at all (FR-017)
- [X] T024 [US2] Add negative-price and zero-quantity rejection cases to `test/integration/orders/money-boundaries.spec.ts`, and confirm a zero price is accepted (US2 scenario 3, plus the edge case that a promotional line legitimately carries no charge)
- [X] T025 [US2] Mutation check: remove the range clause from one monetary column, run the suite, confirm it goes red, restore the clause. Record the result in `test/integration/README.md`

**Checkpoint**: US2 is independently verifiable.

---

## Phase 5: User Story 3 - Historical line items cannot be rewritten (Priority: P3)

**Goal**: Prove stored financial history is unreachable by update, by delete, and by cascade.

**Independent Test**: Attempt every route to changing or removing a stored line item and assert all
are refused with the row unchanged.

- [X] T026 [P] [US3] Add `test/integration/orders/immutability.spec.ts` asserting an update to a line item's captured unit price is aborted and the stored value is unchanged (US3 scenario 1)
- [X] T027 [US3] Add cases to `immutability.spec.ts` for updates to quantity, order reference, product reference, and product description (US3 scenario 2, FR-022 and FR-023)
- [X] T028 [US3] Add a case to `test/integration/orders/immutability.spec.ts` asserting a direct delete of a line item is aborted and the row remains (US3 scenario 6, FR-025a)
- [X] T029 [US3] Add `test/integration/orders/permanence.spec.ts` asserting an order cannot be deleted after every route to removing its line items has been tried, and that deleting a referenced customer or product is refused (US3 scenarios 3 and 7, FR-025b and FR-010a)
- [X] T030 [US3] Add `test/integration/orders/price-capture.spec.ts` asserting that changing a product's catalog price and name leaves the stored line item reporting the values captured when the order was placed (US3 scenario 5). This is the test the `products.unit_price_minor` column exists for
- [X] T031 [US3] Add a case to `test/integration/orders/immutability.spec.ts` asserting an update to an order's creation timestamp is aborted (US3 scenario 4, FR-024)
- [X] T032 [US3] Mutation check: drop the `order_line_items_undeletable` trigger, run the suite, confirm it goes red, restore it

**Checkpoint**: US3 is independently verifiable.

---

## Phase 6: User Story 4 - Status is a closed set that supports a conditional write (Priority: P4)

**Goal**: Prove the status field is closed, defaults correctly, and yields a changed-row count the
409 decision can be taken from.

**Independent Test**: Store an illegal status and assert rejection; run the conditional update twice
and assert 1 then 0.

- [X] T033 [P] [US4] Add `test/integration/orders/status.spec.ts` asserting a value outside `pending`, `processing`, `cancelled` is rejected, and that all three are accepted (US4 scenario 1)
- [X] T034 [US4] Add a case asserting a newly inserted order carries `pending` without the insert supplying it (US4 scenario 4, FR-028)
- [X] T035 [US4] Add `test/integration/orders/conditional-update.spec.ts` asserting the conditional update from `contracts/persistence.md` reports exactly 1 changed row on match and exactly 0 on a repeat, with no third outcome (US4 scenarios 2 and 3)
- [X] T036 [US4] Extend `conditional-update.spec.ts` to assert that after a matching update `updated_at_us` has advanced and `created_at_us` has not, even though the statement named neither, and that after a non-matching update no timestamp moved (US4 scenarios 5 and 6, FR-034a). This is the assertion Principle II's 409 depends on
- [X] T037 [US4] Mutation check: drop the `orders_touch_updated_at` trigger, run the suite, confirm it goes red, restore it. Then temporarily rewrite it to update every row rather than the one row, and confirm the changed-row count assertion in T035 catches it (FR-034b)

**Checkpoint**: US4 is independently verifiable.

---

## Phase 7: User Story 5 - The queries the system will run are served by indexes (Priority: P5)

**Goal**: Prove the three committed access patterns do not scan, and that keyset paging is total.

**Independent Test**: Populate the tables and inspect the query plan for each of the three shapes.

- [X] T038 [US5] Add a bulk seed helper to `test/support/order-fixtures.ts` that inserts at least 10,000 orders with line items inside a single transaction, including several sharing an identical `created_at_us`
- [X] T039 [P] [US5] Add `test/integration/orders/query-plans.spec.ts` asserting the keyset page plan uses `orders_created_at_id_idx` and reports no full scan (US5 scenario 1, FR-036)
- [X] T040 [US5] Add a case asserting the bounded backlog claim plan uses `orders_status_created_at_id_idx` and reports no full scan (US5 scenario 2, FR-037)
- [X] T041 [US5] Add a case asserting the line item fetch by a set of order ids uses `order_line_items_order_id_idx` and reports no full scan (US5 scenario 3, FR-038)
- [X] T042 [US5] Add `test/integration/orders/keyset-pagination.spec.ts` paging the entire seeded set and asserting every order appears exactly once, with zero duplicates and zero omissions, including across orders sharing a microsecond (US5 scenario 4, SC-008)
- [X] T043 [US5] Mutation check: drop `orders_status_created_at_id_idx`, run the suite, confirm the plan assertion goes red, restore it

**Checkpoint**: All five stories are independently verifiable.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T044 Measure the cost of the table rebuild at per-file and per-test granularity, choose one, and replace the open question in `specs/002-order-entities/research.md` R8 with the measured numbers and the decision. Do not choose without measuring
- [X] T045 Update `test/integration/README.md` to document the two isolation mechanisms, which tables use which, and why, plus the mutation-check results recorded in T025, T032, T037, and T043
- [X] T046 [P] Add a row to the decision log in `README.md` for the constitution amendment to v2.1.0, covering why blocking deletion forced Principle VI to be restated as a property rather than a mechanism
- [X] T047 [P] Add a row to the decision log in `README.md` for the trigger source-of-truth deviation recorded in the plan's Complexity Tracking, since a reviewer reading only the schema modules will not see the triggers
- [X] T048 Run every scenario in `specs/002-order-entities/quickstart.md` end to end against a fresh database and confirm each expected outcome
- [X] T049 Run `npm run check` and confirm a clean exit, then run `npm test` twice consecutively and confirm identical results (SC-009, and Spec 001's SC-005)
- [X] T050 Full mutation sweep for SC-010 across `src/database/schema/` and the trigger migration under `drizzle/`: remove each constraint, trigger, and index in turn, confirm the suite goes red for every one, and restore. Any guarantee whose removal leaves the suite green needs a test before this feature is done

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story**, because all five read the same tables
- **User Stories (Phases 3 to 7)**: All depend on Foundational. Independent of each other thereafter
- **Polish (Phase 8)**: Depends on all five stories

### Within Phase 2

T003 and T004 are parallel. T005 and T006 are sequential after them only because both reference the
placeholder tables they point at. T007 depends on T003 through T006. T008 depends on T007. T009 and
T010 depend on T008, because the trigger migration must come after the tables it guards. T011 depends
on T010. T012 and T013 depend on T011.

### User Story Dependencies

- **US1 (P1)**: No dependencies beyond Phase 2. The MVP
- **US2 (P2)**: Independent of US1, though it reuses the fixture builder from T015
- **US3 (P3)**: Independent. Needs the triggers from T010
- **US4 (P4)**: Independent. Needs the triggers from T010
- **US5 (P5)**: Independent. Needs the indexes from T005 and T006, and the bulk seed from T038

### Parallel Opportunities

- T001 and T002 in Setup
- T003 and T004 in Foundational
- Within each story, every task marked [P] writes to a different file
- After Phase 2, all five story phases can proceed at once if staffed

Mutation checks (T025, T032, T037, T043, T050) are **never** parallel. Each one temporarily breaks the
schema, so two running at once would make it impossible to attribute a red suite to either.

---

## Parallel Example: User Story 3

Only T026 is marked [P] in this phase, because T027, T028, and T031 all append cases to the file
T026 creates. What can genuinely run alongside it is the work in other files:

```bash
# T026, T029, and T030 write to three different spec files:
Task: "Assert update to captured unit price is aborted in test/integration/orders/immutability.spec.ts"
Task: "Assert an order cannot be deleted by any route in test/integration/orders/permanence.spec.ts"
Task: "Assert a catalog price change does not reach a stored line in test/integration/orders/price-capture.spec.ts"
```

T029 and T030 are not marked [P] only because they follow T026 in sequence; if the phase is staffed
by more than one person, all three files are independent.

---

## Implementation Strategy

### MVP First

1. Phase 1: Setup
2. Phase 2: Foundational, which is the bulk of the actual construction
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: an order round-trips faithfully and its references are enforced

At that point the schema exists and is proven honest about what it stores. Phases 4 through 7 then add
proof for one family of guarantees each, in priority order, and any of them can be deferred without
invalidating the ones already done.

### The one thing not to defer

T050, the full mutation sweep. Every other task adds a guarantee or a test for one. T050 is what
establishes that the tests are actually load-bearing, which is the difference between a suite that
passes and a suite that means something. SC-010 is written in exactly those terms.
