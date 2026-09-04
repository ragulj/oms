---

description: "Task list for Project Foundation (spec 001)"
---

# Tasks: Project Foundation

**Input**: Design documents from `/specs/001-project-foundation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/health.md](./contracts/health.md), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included and are not optional here. Constitution v2.0.0 Principle VI
requires an integration test for every core claim, FR-019 requires a zero-test run to fail the
build, and User Story 3 is the test harness itself.

**Organization**: Tasks are grouped by user story so each can be implemented, tested, and
demonstrated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1 through US6)
- Exact file paths are included in every task

## Path Conventions

Single project. `src/` and `test/` at repository root, per the Structure Decision in plan.md.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the project. The two blocking decisions are settled (T001, T002).

**T001 and T002 are already complete.** Both were settled by experiment on 2026-09-05 and the
outcomes are recorded in [research.md](./research.md). They are retained as checked items
rather than deleted, because the rest of Phase 1 reads as nonsense without the decisions they
carry.

- [x] T001 Resolve the SQLite driver decision (research.md R1) → **`better-sqlite3@13.0.3`**. Verified on win32-x64/Node 24: ships prebuilt binaries in the npm tarball (no node-gyp, no Python), reports genuine SQLite 3.53.4, applies WAL, returns changed-row counts, supports native transactions. Recorded in specs/001-project-foundation/research.md
- [x] T002 Resolve the TypeScript major version (research.md R2) → **`typescript@5.9.3`**. TS 7.0.2 was tested and drives NestJS DI correctly, but removes `moduleResolution: node10` that NestJS tooling generates; rejected on ergonomics, not capability. Recorded in specs/001-project-foundation/research.md
- [ ] T003 Initialize package.json at repository root, setting `engines.node` to **">=22"**, the floor derived per FR-003 (better-sqlite3 requires >=22, above the framework's >=20)
- [ ] T004 Install NestJS runtime dependencies (@nestjs/core, @nestjs/common, @nestjs/platform-express, reflect-metadata, rxjs) at the versions pinned in plan.md
- [ ] T005 [P] Install Drizzle dependencies (drizzle-orm@0.45.2, drizzle-kit@0.31.10) into package.json
- [ ] T006 [P] Install better-sqlite3@13.0.3 and @types/better-sqlite3 into package.json
- [ ] T007 [P] Install typescript@5.9.3 and the test toolchain (jest@30.5.1, ts-jest, @nestjs/testing, @types/node) as devDependencies in package.json
- [ ] T008 [P] Install the lint and format toolchain (eslint, prettier, and the TypeScript ESLint plugins), recording it in package.json
- [ ] T009 Create the source directory skeleton (src/config/, src/database/schema/, src/health/, src/logging/, src/scheduler/, test/setup/, test/integration/) per the Structure Decision in plan.md

**Checkpoint**: dependencies install cleanly on a machine with no C++ toolchain, or the
prerequisite is documented.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

Configuration here is deliberately minimal, loading values without validating them. Fail-fast
validation is User Story 4's deliverable and is not duplicated here.

- [ ] T010 Create tsconfig.json at repository root using the NestJS-default `module: commonjs` with `moduleResolution: node`, `experimentalDecorators`, `emitDecoratorMetadata`, and the strictest supported type checking per FR-024 (this exact combination was verified clean against typescript@5.9.3)
- [ ] T011 [P] Implement the structured logger emitting machine-parseable records to stdout in one format for all environments, with configurable verbosity, in src/logging/logger.ts (FR-031)
- [ ] T012 [P] Implement secret redaction in the logger in src/logging/redact.ts (FR-031)
- [ ] T013 Implement minimal configuration loading for the settings enumerated in data-model.md, without validation, in src/config/configuration.ts (FR-005)
- [ ] T014 Implement the Drizzle database client applying journal_mode=WAL, foreign_keys=ON, and a non-zero busy_timeout on every connection it opens, in src/database/client.ts (FR-013)
- [ ] T015 Create the root application module wiring config, logging, and database in src/app.module.ts
- [ ] T016 Create the bootstrap entry point in src/main.ts
- [ ] T017 Create jest.config.ts at repository root configured to execute test files serially, never in parallel (FR-016)
- [ ] T018 Create the shared test bootstrap helper that builds a testing module against a real database in test/setup/test-app.ts

**Checkpoint**: the service starts, logs a structured record, and opens a database connection.

---

## Phase 3: User Story 1 - Run the service from a clean clone (Priority: P1) 🎯 MVP

**Goal**: A developer clones, installs, configures, starts, and gets a healthy health check.

**Independent test**: On a machine with only the runtime installed, follow the documented
commands and confirm the health check reports healthy. No other story needs to exist.

- [ ] T019 [US1] Configure the global route prefix so future domain routes sit under a versioned prefix while the health check stays outside it, in src/main.ts (FR-035, contracts/health.md)
- [ ] T020 [US1] Create the health module in src/health/health.module.ts
- [ ] T021 [US1] Implement the health service checking database reachability in src/health/health.service.ts (FR-030)
- [ ] T022 [US1] Implement the health controller returning success only when service and database are both healthy, and a failure status naming the failing dependency otherwise, in src/health/health.controller.ts (FR-030, contracts/health.md)
- [ ] T023 [US1] Add the install, start:dev, build, and start:prod command roles to package.json scripts (FR-001, FR-004)
- [ ] T024 [P] [US1] Integration test asserting a running service with a reachable database reports healthy, in test/integration/health.healthy.spec.ts (US1 scenario 1)
- [ ] T025 [P] [US1] Integration test asserting the response reports both overall status and database reachability, in test/integration/health.shape.spec.ts (US1 scenario 2)
- [ ] T026 [P] [US1] Integration test asserting a database made unreachable after startup produces a failure status naming the database, in test/integration/health.degraded.spec.ts (US1 scenario 4)

**Checkpoint**: MVP reached. Clone to healthy service works end to end.

---

## Phase 4: User Story 2 - Rebuild the database schema reproducibly (Priority: P2)

**Goal**: One command builds the schema from empty; a second run changes nothing; a service
with pending migrations refuses to start.

**Independent test**: Delete the database, run the migration command, confirm the schema
matches the committed migrations. Run it again and confirm it reports nothing to do.

- [ ] T027 [US2] Create drizzle.config.ts at repository root pointing at src/database/schema/ and the drizzle/ migration output directory (FR-010)
- [ ] T028 [US2] Create the schema barrel module establishing src/database/schema/ as the single source of truth in src/database/schema/index.ts (FR-010)
- [ ] T029 [US2] Add the db:generate command role to package.json scripts (FR-012)
- [ ] T030 [US2] Implement the migration application entry point, safe to run repeatedly, in src/database/migrate.ts (FR-011)
- [ ] T031 [US2] Add the db:migrate command role to package.json scripts (FR-011)
- [ ] T032 [US2] Implement the startup migration-state check that compares the migration ledger against committed migration files and refuses to boot when any are pending, naming them, in src/database/migration-state.ts (FR-015)
- [ ] T033 [US2] Wire the migration-state check into the bootstrap sequence after the database connection and before serving, in src/main.ts (FR-015, data-model.md lifecycle table)
- [ ] T034 [P] [US2] Integration test asserting migrations applied against an empty database create the schema and exit successfully, in test/integration/migrate.fresh.spec.ts (US2 scenario 1)
- [ ] T035 [P] [US2] Integration test asserting a second migration run makes no changes and exits successfully, in test/integration/migrate.idempotent.spec.ts (US2 scenario 2)
- [ ] T036 [P] [US2] Integration test asserting startup with a pending migration exits non-zero before serving and names the pending migration, in test/integration/migrate.pending-blocks-start.spec.ts (US2 scenario 5, FR-015)

**Checkpoint**: schema is reproducible and the service cannot run against a stale one.

---

## Phase 5: User Story 3 - Trust the test suite (Priority: P3)

**Goal**: The harness itself becomes trustworthy: real database, isolated tests, and an empty
run reported as a failure.

**Independent test**: Run any single test alone and again inside the full suite and confirm
identical results. Point the runner at a pattern matching nothing and confirm a non-zero exit.

**Why this story matters more than its priority suggests**: every test written in Phases 3 and
4 is only as trustworthy as this harness. Consider promoting it if those tests start behaving
inconsistently.

- [ ] T037 [US3] Implement throwaway test database creation per run, with all migrations applied before the first test, in test/setup/database.ts (FR-018)
- [ ] T038 [US3] Implement per-test cleanup clearing touched tables with DELETE FROM in a beforeEach hook, in test/setup/truncate.ts (FR-017, Constitution VI)
- [ ] T039 [US3] Implement teardown that removes the throwaway database and releases resources, including when a test fails or the run is interrupted, in test/setup/teardown.ts (FR-018, FR-021)
- [ ] T040 [US3] Configure the test runner to fail with a non-zero exit when a run executes zero tests, in jest.config.ts and package.json (FR-019)
- [ ] T041 [US3] Add the test command role to package.json scripts (FR-016)
- [ ] T042 [P] [US3] Integration test asserting a test inserting rows leaves the next test with an empty starting state, in test/integration/harness.isolation.spec.ts (US3 scenario 1)
- [ ] T043 [P] [US3] Integration test asserting the same outcome for a test run alone and within the full suite, in test/integration/harness.order-independence.spec.ts (US3 scenario 2, FR-020)
- [ ] T044 [P] [US3] Integration test asserting the test database carries the same connection settings the running service applies, in test/integration/harness.pragmas.spec.ts (US3 scenario 5, FR-013)
- [ ] T045 [US3] Verification that a selection matching zero tests exits non-zero, documented in test/integration/README.md as a manual check because it cannot assert on itself from inside the suite (US3 scenario 3, FR-019, SC-006)

**Checkpoint**: test results can be believed.

---

## Phase 6: User Story 4 - Fail fast on bad configuration (Priority: P4)

**Goal**: A missing or malformed setting stops startup with a message naming the culprit.

**Independent test**: Remove a required setting, start, and confirm a non-zero exit naming it.

- [ ] T046 [US4] Implement the configuration schema covering every setting in data-model.md, with required flags, defaults, and rejection of zero or negative durations, in src/config/config.schema.ts (FR-006)
- [ ] T047 [US4] Implement startup validation that runs before traffic is accepted or scheduled work is registered, exiting non-zero with a message naming the setting and its expected shape, in src/config/config.validation.ts (FR-006, FR-007)
- [ ] T048 [US4] Create the committed example settings file enumerating every recognised setting with safe placeholders and no real secrets, at .env.example (FR-008)
- [ ] T049 [US4] Add actual settings files to .gitignore (FR-009)
- [ ] T050 [P] [US4] Integration test asserting an absent required setting exits non-zero before any request is accepted, naming the setting, in test/integration/config.missing.spec.ts (US4 scenario 1)
- [ ] T051 [P] [US4] Integration test asserting a malformed setting exits non-zero naming the setting and what was expected, in test/integration/config.malformed.spec.ts (US4 scenario 2)
- [ ] T052 [P] [US4] Integration test asserting the example settings file enumerates every recognised setting and contains no secrets, in test/integration/config.example-complete.spec.ts (US4 scenario 4)

**Checkpoint**: misconfiguration is caught at the boundary, not deep in a call stack.

---

## Phase 7: User Story 5 - Keep the codebase consistent (Priority: P5)

**Goal**: One command reports style, lint, and type violations; another fixes what it can.

**Independent test**: Introduce a deliberate style violation and a deliberate type error, run
the check command, and confirm both are reported with a non-zero exit.

- [ ] T053 [P] [US5] Create the ESLint configuration with TypeScript rules at eslint.config.mjs
- [ ] T054 [P] [US5] Create the formatter configuration at .prettierrc
- [ ] T055 [US5] Add the aggregate check command role running format, lint, and type checking with a non-zero exit on any violation, to package.json scripts (FR-022, FR-024)
- [ ] T056 [US5] Add the fix command role correcting mechanically fixable violations, to package.json scripts (FR-023)
- [ ] T057 [US5] Verify the check command in package.json passes on an unmodified clean clone (FR-025, US5 scenario 4)

**Checkpoint**: the quality gate is runnable before every push.

---

## Phase 8: User Story 6 - Prove scheduled work can run (Priority: P6)

**Goal**: Recurring work registers, fires on its interval, and never overlaps itself.

**Independent test**: Start the service with a shortened interval, observe at least six
consecutive intervals, and confirm evidence from each with no overlapping executions.

- [ ] T058 [US6] Install and register @nestjs/schedule in src/app.module.ts (FR-026)
- [ ] T059 [US6] Implement the placeholder recurring task emitting observable evidence and carrying no business behaviour, in src/scheduler/heartbeat.task.ts (FR-027)
- [ ] T060 [US6] Implement the in-flight guard preventing a new execution from starting while the previous one runs, in src/scheduler/overlap-guard.ts (FR-028, data-model.md)
- [ ] T061 [US6] Wire the interval to configuration with a five minute default and confirm tests can override it, in src/config/config.schema.ts and src/scheduler/scheduler.module.ts (FR-029)
- [ ] T062 [P] [US6] Integration test asserting the task executes and leaves observable evidence on each elapsed interval, in test/integration/scheduler.fires.spec.ts (US6 scenario 1)
- [ ] T063 [P] [US6] Integration test asserting an execution still running when the next is due is skipped rather than started concurrently, in test/integration/scheduler.no-overlap.spec.ts (US6 scenario 2, SC-008)
- [ ] T064 [P] [US6] Integration test asserting a changed interval takes effect on restart without a code change, in test/integration/scheduler.configurable.spec.ts (US6 scenario 3)

**Checkpoint**: recurring work is proven, ready to be replaced by the real job in a later spec.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Requirements that belong to no single user story.

**Not optional despite the phase name**: the shutdown lifecycle (FR-032 to FR-034, SC-010) is
a full requirement group. It sits here because it has no user story of its own and because it
cannot be completed until the scheduler from Phase 8 exists to be stopped.

- [ ] T065 Enable Nest shutdown hooks and implement drain on termination signal, stopping new requests, letting in-flight requests and any running scheduled task finish, then closing the database, in src/main.ts (FR-032)
- [ ] T066 Implement the drain timeout defaulting to ten seconds, force-exiting non-zero and recording what was abandoned when it expires, in src/main.ts and src/config/config.schema.ts (FR-033)
- [ ] T067 Prevent new scheduled executions once shutdown has begun, in src/scheduler/overlap-guard.ts (FR-034)
- [ ] T068 [P] Emit the startup record confirming resolved configuration source, database location, applied connection settings, and registered recurring tasks, with secrets redacted, in src/main.ts (FR-031)
- [ ] T069 [P] Integration test asserting a shutdown drains fully within the timeout and exits zero, leaving no database recovery needed on next start, in test/integration/shutdown.drain.spec.ts (SC-010)
- [ ] T070 [P] Integration test asserting a drain timeout expiry exits non-zero and records the abandoned work, in test/integration/shutdown.timeout.spec.ts (FR-033)
- [ ] T071 [P] Integration test asserting every log record from a full run parses as a structured record with no secrets present, in test/integration/logging.parseable.spec.ts (SC-011)
- [ ] T072 Implement runtime version enforcement refusing to run below the derived floor, in src/main.ts (FR-003)
- [ ] T073 Document every command role, the minimum runtime version, and the setup sequence in README.md (FR-001, FR-003, SC-009)
- [ ] T074 Walk through quickstart.md end to end on a clean clone and confirm every documented command succeeds first time (SC-001, SC-002)

---

## Dependencies

### Phase order

```text
Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3)
                                                → Phase 6 (US4) → Phase 7 (US5) → Phase 8 (US6)
                                                                        → Phase 9 (Polish)
```

### Hard dependencies

| Task | Blocked by | Reason |
|------|-----------|--------|
| T003 | T001, T002 ✅ satisfied | The `engines.node` floor is derived from the chosen dependencies (FR-003); resolved to `>=22` |
| T006 | T001 ✅ satisfied | Driver chosen: better-sqlite3@13.0.3 |
| T014 | T006 | The database client is written against `better-sqlite3` |
| T033 | T032 | Cannot wire a check that does not exist |
| T040 | T017 | The zero-test gate is runner configuration |
| T061 | T046 | The interval setting belongs to the configuration schema |
| T065–T067 | Phase 8 | Shutdown must stop a scheduler that exists |
| T074 | All | It is the end-to-end validation |

### Story independence

US1, US2, US4, US5, and US6 are independently testable once Phase 2 completes. US3 is
independently testable but retroactively strengthens the tests written in earlier phases,
which is the one place the priority ordering and the dependency ordering disagree.

---

## Parallel execution examples

**Phase 1, after T001 and T002 resolve:**

```text
T005, T006, T007, T008 in parallel (separate installs, no shared files)
```

**Phase 2:**

```text
T011, T012 in parallel (logger and redaction are separate files)
```

**Phase 3 (US1) tests:**

```text
T024, T025, T026 in parallel (three separate spec files)
```

**Phase 4 (US2) tests:**

```text
T034, T035, T036 in parallel
```

**Phase 6 (US4) tests:**

```text
T050, T051, T052 in parallel
```

**Phase 9:**

```text
T068, T069, T070, T071 in parallel
```

---

## Implementation strategy

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)**, tasks T001 through T026. That delivers a service a
developer can clone, configure, start, and verify healthy, which is the smallest slice with
standalone value and the one everything else is demonstrated on top of.

### Incremental delivery

Each phase from 4 onward adds one independently demonstrable capability. Stop at any
checkpoint and the repository is in a coherent, working state.

### Sequencing advice

T001 and T002 are done, so implementation can start at T003 with no open decisions. Their
answers did change other tasks rather than adding to them, which is why they came first: the
driver fixed T006 and T014, and it raised the Node floor in T003 from 20 to 22 without a
separate decision being made.

The driver outcome also removed three risks the plan had been carrying. It is genuine SQLite,
so no constitutional amendment is needed. It ships prebuilt binaries, so the absent Python
toolchain on this host never binds. It has native transactions, so Principle III's per-chunk
commits are supported directly.

Consider pulling Phase 5 (US3) forward if the tests in Phases 3 and 4 start behaving
inconsistently. Flaky tests on a single-writer database are usually harness isolation
problems, and that is exactly what US3 fixes.
