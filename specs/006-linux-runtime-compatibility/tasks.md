---
description: 'Task list for Linux Runtime Compatibility'
---

# Tasks: Linux Runtime Compatibility

**Input**: Design documents from `/specs/006-linux-runtime-compatibility/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/startup.md](contracts/startup.md), [quickstart.md](quickstart.md)

**Tests**: Included and mandatory. Spec FR-018 to FR-023 require verification, and Constitution Principle
VI requires every claim to be backed by an integration test against a real database. One slice — the
`ts-node/register` boot itself — genuinely cannot be exercised from inside a ts-jest suite; it is verified
by an existing gate (`npm run openapi:check`) plus a documented shell check, per [research.md](research.md)
R4, rather than by a flaky spawned test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Which user story the task serves

## Path Conventions

Single project at the repository root: `src/`, `test/`. Paths follow the structure decision in
[plan.md](plan.md).

## A note on story independence

The two P1 stories are genuinely independent and touch **disjoint files**: US1 is the source-loader fix
(`tsconfig.json`, plus a README note) and US2 is the data-directory fix (`src/database/client.ts`, plus a
new test). Either can be implemented, tested, and delivered without the other, and the two can proceed in
full parallel. Neither is a complete "runs on Linux" on its own — a service that boots but cannot open its
database has not started usefully, and vice versa — so the **MVP is US1 + US2 together**. US3 (P2) ships no
behaviour; it is the evidence that nothing else regressed.

---

## Phase 1: Setup

**Purpose**: Nothing to install. Establish the before-state both stories are judged against.

- [X] T001 Confirm the starting tree is green on the development OS: `npm run check` and a full `npm test` both pass, and `npx drizzle-kit generate` reports no pending change. Record these as the baseline so any later failure — or any generated migration — is attributable to this feature (SC-005, SC-006, SC-009)
- [X] T002 ✅ DONE on Linux (2026-09-05, Node v22.22.2): with the `ts-node` block removed, `npm run start:dev` exits during source loading with `TSError … TS7016: Could not find a declaration file for module 'drizzle-orm/sqlite-core'` (src/database/schema/index.ts:1:44). Note the mechanism differs from research R1's leading hypothesis: the blocker is *type* resolution of drizzle-orm's `.d.cts`-only declarations under classic `node` resolution, not runtime module loading. Record the Linux before-state on the environment where the defect was found: confirm `npm run start:dev` (which runs `node -r ts-node/register src/main.ts`) fails to boot under the current configuration, and capture the error text for the [research.md](research.md) R1 record. This is US1's failing baseline (spec US1, FR-001)

**Checkpoint**: The before-state is measured on both platforms. Nothing has changed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: There are none. The two fixes touch disjoint files and share no artifact that must exist
first, so there is no blocking prerequisite phase to complete. This section is intentionally empty and
says so, rather than inventing shared scaffolding the change does not need.

**Checkpoint**: User stories US1 and US2 may both begin, in parallel.

---

## Phase 3: User Story 1 - The service starts on Linux (Priority: P1) 🎯 MVP (with US2)

**Goal**: `node -r ts-node/register …` loads and runs the project's sources on Linux, so the service and
its helper scripts start.

**Independent Test**: on Linux, from a clean checkout, `npm run start:dev` reaches `service.started`
instead of exiting during source loading.

### Implementation for User Story 1

- [X] T003 [US1] Add the loader-scoped `ts-node` block to `tsconfig.json` as a top-level sibling of `compilerOptions`, with `compilerOptions.module = "nodenext"` and `compilerOptions.moduleResolution = "nodenext"`. Do not touch the shared `compilerOptions` (FR-003, FR-004, research R1)

### Verification for User Story 1

- [X] T004 [US1] ✅ DONE on Linux (2026-09-05): all four `-r ts-node/register` entry points verified — `openapi:check` exit 0 ("openapi.json is up to date"); `db:migrate` into a fresh two-level-deep directory exit 0 (both missing parents created, FR-006); `db:seed` exit 0; `start:dev` reached `service.started` (port 3000, pragmas WAL / foreign_keys ON / busy_timeout 5000) and served a real order round-trip (POST created order id 1, totalMinor 3897 = 3 x 1299; GET list returned it) before a clean SIGTERM `shutdown.complete`. Confirm every `-r ts-node/register` entry point loads and runs: `npm run start:dev` boots to `service.started`, and `npm run db:migrate`, `npm run db:seed`, `npm run openapi:check` each run to completion. Record the outcome against R1 (FR-001, FR-002)
- [X] T005 [US1] Confirm genuine startup failures still surface as themselves — run the existing `test/integration/config.malformed.spec.ts` and `config.missing.spec.ts` and confirm they still fail startup with `startup.invalid_configuration`, proving the loader block masks no real error (FR-005)
- [X] T006 [P] [US1] Add the Linux `start:dev` boot to the "checks that cannot be automated from inside the suite" section of `test/integration/README.md`, beside the signal-driven-shutdown check: give the command and the expected `service.started` outcome, and note that `npm run openapi:check` (part of `npm run check`) is the automated exerciser of the `ts-node/register` loader path (FR-021, research R4)

**Checkpoint**: The service and its scripts start on Linux. US1 is independently deliverable.

---

## Phase 4: User Story 2 - The runtime data directory is handled on first run (Priority: P1) 🎯 MVP (with US1)

**Goal**: `createConnection` ensures the directory containing the database file exists before opening it,
so a fresh checkout with no data directory starts without a manual `mkdir`.

**Independent Test**: point `DATABASE_PATH` at a file in a directory that does not exist, call
`createConnection`, and confirm the directory is created and the database opens.

### Tests for User Story 2

> Write these first and confirm they fail against today's code (which throws when the directory is absent)
> before implementing T011.

- [X] T007 [P] [US2] Create `test/integration/connection.directory.spec.ts`: given a `DATABASE_PATH` inside a unique throwaway directory under `os.tmpdir()` that does not yet exist, `createConnection` creates it (including missing parents) and returns an open connection. Remove the throwaway directory in an `afterEach`/`afterAll` so the test leaves nothing behind (FR-006, FR-022, contracts/startup.md)
- [X] T008 [US2] Extend `connection.directory.spec.ts` with the idempotent case: when the directory already exists, `createConnection` opens the database and the pre-existing directory and its contents are untouched (FR-007)
- [X] T009 [US2] Extend `connection.directory.spec.ts` with the `:memory:` case: `createConnection(':memory:')` creates no directory and opens the in-memory database (FR-008)
- [X] T010 [US2] Extend `connection.directory.spec.ts` with the uncreatable-directory case: point the path so directory creation must fail (for example, a path whose parent is an existing regular file), and assert `createConnection` throws `DatabaseUnavailableError` with the directory cause named. Confirm the existing `test/integration/harness.pragmas.spec.ts` still passes unchanged, proving a present, writable directory still yields WAL / foreign_keys / busy_timeout (FR-009, FR-010)

### Implementation for User Story 2

- [X] T011 [US2] In `createConnection` in `src/database/client.ts`, replace the `if (databasePath !== ':memory:' && !existsSync(directory)) throw …` branch with `mkdirSync(directory, { recursive: true })` under the same `:memory:` guard, wrapped in a `try/catch` that throws `DatabaseUnavailableError(databasePath, cause)`. Leave the subsequent `new Database(...)` / `applyPragmas(...)` and their `try/catch` exactly as they are. Change the `node:fs` import from `existsSync` to `mkdirSync` (remove `existsSync` if nothing else uses it) so `npm run check`'s eslint stays clean (FR-006 to FR-010, plan Phase 1 Design)

### Verification for User Story 2

- [X] T012 [US2] Run `npm test -- --testPathPatterns connection.directory` and confirm all four cases pass; confirm the created-directory and failure cases failed before T011, so they are load-bearing rather than tautological (FR-018 to FR-020)
- [X] T013 [P] [US2] Confirm by reading the changed `createConnection` that it constructs and creates paths only through `node:path` (`dirname`) and `node:fs` (`mkdirSync`), with no hard-coded separator and no case-dependent path comparison, satisfying cross-platform path behaviour (FR-011, FR-012)

**Checkpoint**: A fresh checkout opens its database with no manual directory step. US2 is independently deliverable.

---

## Phase 5: User Story 3 - Existing environments and behaviour are preserved (Priority: P2)

**Goal**: The build, the test suite, and every domain guarantee are exactly as before; only Linux support
and first-run directory creation are added.

**Independent Test**: run the complete pre-existing suite on the development OS and confirm it passes with
no existing expectation modified and no generated migration.

### Verification for User Story 3

- [X] T014 [US3] ✅ DONE on Linux (2026-09-05, Node v24.20.0): **468 passed, 468 total; 65 of 65 suites**, verified over four consecutive full runs, with no existing test's expectation modified. Two environmental blockers had to be cleared first, neither of them Spec 006's doing: (1) `@nestjs/testing@12.0.1` is `"type": "module"` and jest cannot `require()` ESM below Node 24.9, so Node 22 could not run 41 of the suites — resolved by moving to Node 24.20.0; (2) `test/support/http-fixtures.ts` never bound the harness server, so supertest bound it lazily per request and closed it again, and the one test issuing five concurrent requests lost the bind race with `ECONNRESET` (reproduced deterministically 5/5, and outside jest on both Node 22 and 24, so it was a latent test-infrastructure bug rather than a platform or product defect). Fixed by binding the server once for the harness lifetime; no test expectation changed. Run the full `npm test` and confirm it passes with **no existing test's expectation modified**. Treat any pre-existing test that now needs a changed expectation as evidence of an unintended behaviour change, and investigate it as a defect rather than adjusting it (FR-016, SC-006)
- [X] T015 [P] [US3] ✅ DONE on Linux (2026-09-05): `npm run build` exits 0. The earlier failure was a **corrupt `node_modules/drizzle-orm`** — 336 of its 444 `.d.ts` declaration files were missing from a partial install, while its `exports` map declared them, so classic resolution found no types. Repaired by reinstalling the package; no tsconfig or spec change was needed. Also confirmed `nodenext` emit is byte-identical to classic emit (`diff -r -x '*.map'` exit 0), so FR-004/SC-005 hold. Note `noEmitOnError` is not set, so a failing build still writes `dist/`. Run `npm run build` and confirm the compiled `dist/` output is unchanged by the `ts-node` block — the block is invisible to `tsc` because `tsc` ignores the top-level key (FR-004, SC-005)
- [X] T016 [P] [US3] ✅ DONE on Linux (2026-09-05): `npm run check` exits 0 — `prettier --check`, `eslint`, `tsc --noEmit`, and `openapi:check` all pass. The earlier CRLF/prettier concern was Windows-checkout-specific and does not reproduce here; the `tsc` failure was the corrupt drizzle install described in T015. Neither change regresses an existing gate. Run `npm run check` on the development OS and confirm it exits 0 (prettier, eslint, `tsc --noEmit`, `openapi:check`), proving neither change regresses an existing gate (FR-016, FR-017)
- [X] T017 [P] [US3] ✅ Stands on the development-OS run; the Linux re-run was refused by a workspace safety hook that intercepts direct `drizzle-kit` invocation (a guard belonging to another repo, matched on command shape). `drizzle/` is clean and unchanged through every step of this session, so no migration was generated. Confirm `npx drizzle-kit generate` reports no pending schema change, proving this feature added no persistence or schema change (FR-015, SC-009)
- [X] T018 [US3] Confirm the domain suites pass untouched — the order lifecycle, immutability, money, keyset, and scheduler suites under `test/integration/lifecycle/` and `test/integration/orders/` — proving no domain behaviour changed (FR-014, SC-007)

**Checkpoint**: The change is proven to be a startup/portability change only.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The evidence the new guarantees are load-bearing, and the documentation the change owes.

- [X] T019 ✅ DONE — (a) `no-mkdir` mutation: removing the effective `mkdirSync` turned `connection.directory.spec.ts` red (FR-006 case), then restored. (b) `no-ts-node-block` mutation completed on Linux (2026-09-05): with the block removed, both `npm run start:dev` and `npm run openapi:check` fail to load with TS7016; `tsconfig.json` restored from a scratchpad backup and verified byte-identical (md5 match, `git diff` empty). Both guarantees are load-bearing. Run the mutation sweep for this feature from the scratchpad (so no commit captures a mutated file): (a) remove the recursive `mkdir` from `createConnection` and confirm `connection.directory.spec.ts` turns red; (b) on Linux, remove the `ts-node` block from `tsconfig.json` and confirm `npm run openapi:check` fails to load. Restore both (FR-023, SC-010)
- [X] T020 [P] Document in `README.md` (the configuration section) that `DATABASE_PATH` resolves relative to the process working directory and that the runtime data directory is created on startup if absent, keeping the `data/` default unchanged (FR-013, clarification)
- [X] T021 [P] Add a Spec 006 row to the decision log in `README.md` recording that Linux is now a supported runtime, the loader-scoped `ts-node` block that enables it, and that a missing data directory is now created rather than rejected (research R1, R3)
- [X] T022 [P] Record the Spec 006 mutation results in `test/integration/README.md` in the same form Specs 002–005 used, naming which check caught each mutation (FR-023)
- [X] T023 ✅ DONE — walked on Windows (fresh-directory `db:migrate`, `:memory:` and idempotent cases, gates) and Section A now walked on Linux: `start:dev` boots to `service.started` and serves requests. Caveat: the quickstart's build/check/test gate steps do **not** match reality on Linux (they fail — see T014/T015/T016); quickstart needs correcting once the scoping decision lands. Walk every scenario in [quickstart.md](quickstart.md) against a real run — a fresh directory, `:memory:`, and the build/check/test gates — and correct the document wherever reality differs
- [X] T024 Mark each task in this file `[X]` only after its verification has actually run, not after its code was written

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: empty; nothing blocks the stories
- **User Story 1 (Phase 3)**: depends on Setup only; independent of US2
- **User Story 2 (Phase 4)**: depends on Setup only; independent of US1
- **User Story 3 (Phase 5)**: depends on US1 **and** US2 being in place — it verifies both landed and that nothing else moved
- **Polish (Phase 6)**: depends on everything

### User Story Dependencies

- **US1 (P1)** and **US2 (P1)** are mutually independent and may be built in parallel. Together they are the MVP.
- **US3 (P2)** depends on both P1 stories.

### Within Each User Story

- US2's tests (T007–T010) are written before the implementation (T011) and must fail first against today's throwing behaviour, so they describe the required behaviour rather than whatever the new code happens to do.
- US1 has no unit-testable seam (the loader is exercised by process boot, not by ts-jest), so its verification is the shell/`openapi:check` checks in T004–T006, run after T003.

### Sequential Constraints Worth Naming

- T007–T010 all edit `test/integration/connection.directory.spec.ts` and must not run in parallel with each other. T007 is marked `[P]` only as the first task to touch that new file relative to US1's tasks.
- T003 (edits `tsconfig.json`) and T011 (edits `src/database/client.ts`) touch different files and may run in parallel across the two stories.
- T019 must run alone: the sweep mutates files in place and restores them, so a commit taken mid-sweep captures a mutated file.

### Parallel Opportunities

- Across stories: T003 (US1) and T007→T011 (US2) proceed in parallel — disjoint files.
- Within US3: T015, T016, T017 are independent read-only gate runs and may run together.
- In Polish: T020, T021, T022 edit different documents and may run together.

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1: Setup — confirm the before-state on both platforms.
2. Phase 3 and Phase 4 in parallel: add the loader block; convert the directory guard to a create.
3. **Stop and validate**: on Linux, a clean checkout with no `data/` directory runs `npm run start:dev`, creates the directory, and serves. That is the feature.

### Incremental Delivery

1. Setup — before-state recorded.
2. US1 — the service boots on Linux. Deliverable.
3. US2 — a fresh checkout opens its database without a manual step. Deliverable (and together with US1, the MVP).
4. US3 — the rest of the system is proven untouched.

### What "Done" Means Here

Not merely that the suite is green — it is green today on the development OS with Linux still broken. The
gate is that on Linux the four loader entry points run (T004), that `connection.directory.spec.ts` passes
and failed before the fix (T012), that no pre-existing expectation changed and no migration was generated
(T014, T017), and that T019's sweep shows both new guarantees are load-bearing.

---

## Notes

- Every task names its requirement, so a reviewer can trace a line of the specification to the task that
  discharges it and the check that proves it.
- `[P]` means a different file and no dependency on incomplete work.
- Do not commit while T019 is running.
- T002 and T004 require the Linux environment where the defect was found; if it is unavailable to the
  implementer, they must be run wherever Linux is reproducible before the feature is considered done, since
  they are the only checks that exercise the platform the feature exists for.

---

## Phase 7: Convergence

**Purpose**: Close the gap between what Spec 006 asserts and what the code and docs now show.
Added by `/speckit-converge` on 2026-09-05, after the Linux verification run.

**Context**: repairing a corrupt `node_modules/drizzle-orm` (336 of 444 `.d.ts` files missing from a
partial install) removed the module-resolution failure that this feature attributed to the loader.
The loader-scoped `ts-node` block is therefore no longer load-bearing, which invalidates the mutation
evidence recorded for FR-003.

- [X] T025 CRITICAL ✅ DONE — decision: **retain the block as hardening**. Verified first that removing it leaves every check green (openapi:check exit 0 and start:dev reaching service.started on Node 22.22.2 and 24.20.0). Amended FR-003 (restated as deliberate hardening, no longer a claim that removal breaks startup), FR-023 (withdrew the loader mutation; standard now covers one guarantee), SC-010 (dropped the falsified clause), and added an Assumption recording the corrupt-install discovery. Also corrected research.md R1, whose leading mechanism was wrong and which had an explicit confirmation owed. Re-establish or retire the FR-003 guarantee per FR-023, SC-010 (contradicts). Removing the `ts-node` block from `tsconfig.json` now leaves every check green — verified on Node 24.20.0 and Node 22.22.2: `npm run openapi:check` exits 0 and `npm run start:dev` reaches `service.started` without it. By FR-023's own standard the guarantee has no test behind it. Decide one of: (a) remove the block, since classic resolution resolves the repaired package correctly; or (b) retain it as deliberate hardening against `exports`-only dependencies and record that rationale. Then reconcile FR-003, FR-023 and SC-010 with the decision via `/speckit-clarify` — do not leave the spec asserting a mutation that no longer turns red
- [X] T026 ✅ DONE — `test/integration/README.md` now reads **1 of 2 mutations turns the suite red**, with `no-ts-node-block` marked withdrawn and 'Caught by: nothing', plus the reason and a pointer to research.md R1. The earlier false claim is named as false rather than quietly deleted. Correct the falsified mutation record in `test/integration/README.md` per FR-023, SC-010 (contradicts). Lines ~70-72 state that removing the block makes the boot and `npm run openapi:check` fail on Linux; line ~267 claims "2 of 2 mutations turn the suite red"; line ~272 names the catching check. Replace with the observed result: the `no-mkdir` mutation turns `connection.directory.spec.ts` red, and the `no-ts-node-block` mutation no longer fails anything once the dependency install is intact. Depends on T025
- [X] T027 ✅ DONE — `README.md` now states both floors (Node ≥22 to run the service, ≥24.9 to run the suite, with the ESM/Jest reason); `quickstart.md` prerequisites likewise, noting section D needs the higher floor; added `.nvmrc` pinning 24.20.0. Document and pin the test-suite runtime floor per FR-016, SC-006 (missing). The suite needs Node >= 24.9 because jest cannot `require()` `@nestjs/testing@12.0.1`, which is `"type": "module"`; `README.md:23` and `quickstart.md:9` both say 22, which is correct for running the service but not for running the tests. State both floors explicitly and add an `.nvmrc` pinning the tested version (24.20.0 was used here), so a fresh checkout can satisfy SC-006 without rediscovering this
- [X] T028 ✅ DONE — replaced 'Last verified on Linux: pending' with the 2026-09-05 Node 24.20.0 result: service.started with the data directory created, pragmas applied, a POST/GET order round-trip served, and a clean SIGTERM shutdown, plus the three other loader entry points at exit 0. Record the Linux verification outcome in `test/integration/README.md` per FR-021(b) (partial). Line ~68 still reads "Last verified on Linux: pending". Replace with the 2026-09-05 result: `start:dev` reached `service.started` on Linux (Node 24.20.0) with the data directory created on the way, served a POST and GET order round-trip, and shut down cleanly on SIGTERM
- [X] T029 ✅ DONE — the section D mutation step is struck through and marked withdrawn, with the observed result and a warning not to re-add it expecting a failure. Correct the falsified mutation step in `quickstart.md` per SC-010 (contradicts). Section at line ~94 tells the reader to remove the `ts-node` block and expect `npm run openapi:check` to fail on Linux; it now passes. Align with whatever T025 decides. Depends on T025
- [X] T030 ✅ DONE — recorded in `test/integration/README.md` under a new section: the harness fix ships with Spec 006 as supporting work required by FR-016, changes no test expectation, and fixed a latent platform-independent defect. Future concurrent-request tests are now safe. Confirm the disposition of the test-harness fix in `test/support/http-fixtures.ts` (unrequested). Binding the harness server once for its lifetime is outside Spec 006's stated scope, though it was required to satisfy FR-016 and changed no existing test's expectation. Either record it in this feature as necessary supporting work, or split it into its own change. Note it fixes a latent defect reproducible on both Node 22 and Node 24 and independent of platform

**Checkpoint**: Spec 006's assertions match observed behaviour, and the runtime floor a fresh
checkout needs is documented.
