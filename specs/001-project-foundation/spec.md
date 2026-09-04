# Feature Specification: Project Foundation

**Feature Branch**: `001-project-foundation`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Create Spec 001 for the project foundation. Purpose: establish the minimum foundation to build, run, configure, test, and develop the E-Commerce Order Processing System. Scope: Node.js + NestJS + TypeScript setup; SQLite + Drizzle ORM setup; configuration and environment handling; lint configuration; database migration setup; testing and test isolation/teardown setup; add and configure the dependency needed for scheduled jobs/cron; basic developer commands and project setup. This spec must contain no domain functionality. Do not define Order, OrderLineItem, order workflows, state transitions, cancellation, or background order processing logic. Those belong to later specs."

## Clarifications

### Session 2026-09-05

- Q: When the service is told to shut down, what should it do with work that is already in progress? → A: Drain with a bounded timeout. Stop accepting new requests, let in-flight requests and any running scheduled task finish, close the database, then exit. Force exit if the timeout expires.
- Q: Should the test suite run tests in parallel, and if so, how should each worker get its own database? → A: Serial execution against one throwaway database file per run. The engine permits a single writer, so parallel workers would introduce lock contention as a source of flakiness.
- Q: What URL convention should the service use for its routes, given that the health check is the first one and sets the precedent? → A: Domain routes under a versioned prefix; the health check on a stable unversioned path, so supervisors and uptime probes are unaffected by API version changes.
- Q: What should the health check return when the service is running but its database is unreachable? → A: A single endpoint that succeeds only when service and database are both healthy, and otherwise returns a failure status with a body naming the failing dependency. No separate liveness/readiness split, since the declared scope has no orchestrator to serve.
- Q: What format and verbosity should the service's log output use? → A: Machine-parseable structured records on standard output, in the same format in every environment, at a configurable level. Developers pipe through a formatter locally rather than the service maintaining a second output path.

## User Scenarios & Testing *(mandatory)*

The user of this feature is a developer working on the Order Processing System, and the
operator who runs it. This specification delivers no end-customer functionality. Its value
is measured by how quickly and reliably a developer can get to a trustworthy inner loop.

### User Story 1 - Run the service from a clean clone (Priority: P1)

A developer clones the repository onto a machine that has never seen this project, follows
the documented setup commands, and ends up with a running service that reports itself
healthy. No hand editing of source files, no undocumented prerequisites, no tribal knowledge.

**Why this priority**: Nothing else in this specification can be demonstrated until the
service starts. This is the smallest slice that is independently valuable, because it proves
the toolchain, the dependency set, and the entry point all agree with each other.

**Independent Test**: On a machine with only the language runtime installed, clone the
repository, run the documented setup and start commands in order, and confirm the health
check reports healthy. No other story needs to exist for this to be verifiable.

**Acceptance Scenarios**:

1. **Given** a clean clone and a machine with only the runtime installed, **When** the
   developer runs the documented install, configure, and start commands in order, **Then**
   the service starts and its health check reports a healthy status.
2. **Given** a running service, **When** the health check is requested, **Then** the response
   reports both overall service status and whether the database is reachable.
3. **Given** a clean clone, **When** the developer follows the documented commands, **Then**
   no step requires editing a file that is not explicitly called out in the documentation.
4. **Given** a running service whose database has become unreachable since startup, **When**
   the health check is requested, **Then** it reports a failure status and the body names the
   database as the failing dependency.

---

### User Story 2 - Rebuild the database schema reproducibly (Priority: P2)

A developer needs the database schema to exist before anything can be stored. They run one
documented command against an empty database and get the current schema. Another developer
on another machine runs the same command and gets a byte-for-byte equivalent result.

**Why this priority**: Schema drift between machines is the failure that makes every later
specification untrustworthy. This must be settled before any table that matters exists.

**Independent Test**: Delete the local database, run the migration command, and confirm the
schema matches what the committed migration files describe. Run the command a second time
and confirm it reports nothing to do.

**Acceptance Scenarios**:

1. **Given** no database file exists, **When** the developer runs the migration command,
   **Then** the schema is created and the command exits successfully.
2. **Given** a database already at the latest schema version, **When** the migration command
   runs again, **Then** it makes no changes and exits successfully.
3. **Given** a change to the schema definition, **When** the developer runs the migration
   generation command, **Then** a new versioned migration file is produced for review and
   commit.
4. **Given** two developers on different machines, **When** both apply all migrations from
   empty, **Then** both arrive at an identical schema.

---

### User Story 3 - Trust the test suite (Priority: P3)

A developer runs the test suite and can believe the result. Tests run against a real database
configured the same way the running service configures it. Each test starts from a known
empty state. A suite that accidentally matches no tests is reported as a failure, not a pass.

**Why this priority**: The constitution requires every core guarantee to be proven by an
integration test. A suite that leaks state between tests, or that silently passes when it
runs nothing, cannot serve as that proof. The harness has to be correct before the tests
written against it mean anything.

**Independent Test**: Run any single test in isolation and then as part of the full suite,
and confirm identical results. Point the runner at a pattern matching nothing and confirm a
non-zero exit.

**Acceptance Scenarios**:

1. **Given** a test that inserts rows, **When** a subsequent test runs, **Then** that
   subsequent test observes an empty starting state.
2. **Given** any individual test, **When** it is run alone and again as part of the full
   suite, **Then** the outcome is the same in both cases.
3. **Given** a test selection that matches zero tests, **When** the suite runs, **Then** the
   run fails with a non-zero exit status.
4. **Given** a test run, **When** it completes, **Then** the developer's working database is
   unchanged, because tests used a separate throwaway database.
5. **Given** a test run, **When** the database connection is opened, **Then** it carries the
   same durability and integrity settings the running service uses.

---

### User Story 4 - Fail fast on bad configuration (Priority: P4)

A developer or operator starts the service with a missing or malformed setting. Instead of
booting into a broken state and failing later at an unrelated call site, the service refuses
to start and says exactly which setting is wrong.

**Why this priority**: Configuration that is validated late produces failures far from their
cause. This is cheap to build and saves disproportionate debugging time, but the service can
technically run without it, so it sits below the three stories above.

**Independent Test**: Remove a required setting, attempt to start, and confirm a non-zero
exit with a message naming the missing setting.

**Acceptance Scenarios**:

1. **Given** a required setting is absent, **When** the service starts, **Then** it exits
   non-zero before accepting any request, and the message names the absent setting.
2. **Given** a setting present but of the wrong shape, **When** the service starts, **Then**
   it exits non-zero and the message names the setting and what was expected.
3. **Given** a clean clone, **When** the developer copies the committed example settings
   file to its expected location, **Then** the service starts with no further edits.
4. **Given** the committed example settings file, **When** it is inspected, **Then** it lists
   every setting the service recognises and contains no real credentials.

---

### User Story 5 - Keep the codebase consistent (Priority: P5)

A developer runs one command before pushing and learns whether their change violates the
project's style and type rules. A second command fixes the violations that can be fixed
mechanically.

**Why this priority**: Valuable for consistency and for catching a class of defects early,
but the system runs correctly without it, so it ranks below correctness infrastructure.

**Independent Test**: Introduce a deliberate style violation and a deliberate type error, run
the check command, and confirm both are reported with a non-zero exit.

**Acceptance Scenarios**:

1. **Given** a file with a style violation, **When** the check command runs, **Then** the
   violation is reported and the command exits non-zero.
2. **Given** a file with a type error, **When** the check command runs, **Then** the error is
   reported and the command exits non-zero.
3. **Given** mechanically fixable violations, **When** the fix command runs, **Then** they
   are corrected and a re-run of the check command passes.
4. **Given** an unmodified clean clone, **When** the check command runs, **Then** it passes.

---

### User Story 6 - Prove scheduled work can run (Priority: P6)

A developer confirms that the project can register recurring background work on an interval,
that it actually fires, and that a slow run does not stack on top of the next one. No
business behaviour is attached to it.

**Why this priority**: A later specification depends on recurring work, so the capability has
to exist and be observable. It is last because nothing in this specification consumes it, and
a placeholder heartbeat is the entire deliverable.

**Independent Test**: Start the service, wait for more than one configured interval, and
confirm the recurring task left observable evidence each time it ran.

**Acceptance Scenarios**:

1. **Given** the service is running, **When** the configured interval elapses, **Then** the
   recurring task executes and leaves an observable record.
2. **Given** a recurring task still running when its next execution is due, **When** that
   moment arrives, **Then** the overlapping execution is skipped rather than started
   concurrently.
3. **Given** the interval is changed in configuration, **When** the service restarts,
   **Then** the task fires at the new interval without a code change.

---

### Edge Cases

- What happens when a required setting is missing, empty, or the wrong type at startup?
- What happens when the migration command runs against a database that is already current?
- What happens when the database file path points to a directory that does not exist or is
  not writable?
- What happens when the database becomes unreachable after a successful startup, given that
  FR-015 only governs the startup case?
- What happens when the test runner's selection matches zero tests?
- What happens when a test fails partway through and leaves rows behind?
- What happens when the recurring task is still running as its next execution falls due?
- What happens when two commands try to write the database at the same moment, given that
  the engine permits only one writer?
- What happens when a developer runs the test suite while the service is already running
  against the development database?
- What happens when an interrupted earlier run left its throwaway test database behind?
- What happens when the service is stopped abruptly during a write?
- What happens when the shutdown drain timeout expires while a scheduled task is still
  running?

## Requirements *(mandatory)*

### Functional Requirements

**Project setup and developer commands**

- **FR-001**: The repository MUST provide documented commands for installing dependencies,
  starting the service in development, building a production artifact, running the production
  build, applying migrations, generating migrations, running tests, checking code quality, and
  auto-fixing code quality.
- **FR-002**: Every documented command MUST succeed on a clean clone with no manual step
  beyond those written in the documentation.
- **FR-003**: The documentation MUST state the minimum runtime version required, and the
  project MUST refuse to run on an unsupported version rather than failing obscurely.
- **FR-004**: A developer MUST be able to reach a running, healthy service using only the
  documented commands, without editing source files.

**Configuration**

- **FR-005**: The service MUST read all environment-specific settings from the environment
  rather than from committed source.
- **FR-006**: The service MUST validate every recognised setting during startup, before it
  accepts traffic or schedules work.
- **FR-007**: On a missing or invalid setting, the service MUST exit with a non-zero status
  and emit a message naming the offending setting and the expected shape.
- **FR-008**: The repository MUST contain a committed example settings file that enumerates
  every recognised setting with safe placeholder values, and MUST NOT contain real secrets.
- **FR-009**: Actual settings files MUST be excluded from version control.

**Persistence and migrations**

- **FR-010**: The database schema MUST be defined in committed source and MUST be the single
  source of truth from which migrations are produced.
- **FR-011**: Applying pending migrations MUST be a single documented command that is safe to
  run repeatedly, producing no changes when the database is already current.
- **FR-012**: Migration files MUST be versioned, ordered, and committed to the repository.
- **FR-013**: The database connection MUST apply the durability, referential integrity, and
  write-contention settings the constitution requires, and MUST do so at startup for every
  connection the system opens, including those opened by tests.
- **FR-014**: All persistence access MUST go through the single approved data access layer.
  No second access path may exist.
- **FR-015**: The service MUST fail to start, with a clear message, when the configured
  database location is unreachable or not writable.

**Testing**

- **FR-016**: A single documented command MUST run the full test suite against a real
  database rather than a substitute. Test files MUST execute serially rather than in
  parallel, because the database engine admits only one writer and parallel workers sharing
  a database would make lock contention indistinguishable from a real defect.
- **FR-017**: The test harness MUST place each test in a known empty state before it runs.
- **FR-018**: Tests MUST NOT read or write the developer's working database. The suite MUST
  create a throwaway database for the run, apply all migrations to it before the first test,
  and remove it when the run ends.
- **FR-019**: A test run that executes zero tests MUST fail with a non-zero exit status.
- **FR-020**: Any individual test MUST produce the same outcome run alone as it does run
  within the full suite, in any order.
- **FR-021**: The test harness MUST release its database resources on completion, including
  when a test fails or the run is interrupted.

**Code quality**

- **FR-022**: A single documented command MUST report style, lint, and type violations, and
  MUST exit non-zero when any are found.
- **FR-023**: A separate documented command MUST correct mechanically fixable violations.
- **FR-024**: Type checking MUST run in its strictest supported configuration, and a type
  error MUST fail the build.
- **FR-025**: The quality command MUST pass on an unmodified clean clone.

**Scheduled work**

- **FR-026**: The system MUST be able to register recurring work that executes on a
  configurable interval.
- **FR-027**: The recurring work registered by this specification MUST be a placeholder that
  produces observable evidence of execution and carries no business behaviour.
- **FR-028**: A scheduled execution MUST NOT begin while the previous execution of the same
  task is still running.
- **FR-029**: The interval MUST be changeable through configuration without a code change.

**Observability**

- **FR-030**: The service MUST expose a health check at a stable, unversioned path. It MUST
  report success only when the service and its database are both healthy, and MUST report a
  failure status naming the failing dependency otherwise. There MUST NOT be a separate
  liveness endpoint, since no orchestrator exists in the declared scope to consume one.
- **FR-031**: All log output MUST consist of machine-parseable structured records written to
  standard output, in the same format in every environment, at a verbosity controlled by
  configuration. A single format is required so that what an acceptance test asserts on is
  exactly what a developer reads. On startup the service MUST emit such a record confirming
  the resolved configuration source, the database location, the applied connection settings,
  and the registered recurring tasks. Secrets MUST be redacted from all output.

**Service lifecycle**

- **FR-032**: On receiving a termination signal, the service MUST stop accepting new
  requests, allow in-flight requests and any currently executing scheduled task to finish,
  close the database connection cleanly, and exit with a zero status.
- **FR-033**: The drain described in FR-032 MUST be bounded by a configurable timeout. If the
  timeout expires while work is still running, the service MUST exit non-zero and MUST record
  what was abandoned.
- **FR-034**: Once shutdown has begun, the service MUST NOT start a new scheduled execution.

**HTTP conventions**

- **FR-035**: Domain routes introduced by later specifications MUST sit under a versioned
  path prefix, so that a future breaking change can be published alongside the version it
  replaces rather than breaking existing callers. The health check MUST remain outside that
  prefix, because the supervisors and probes that consume it must not have to track the API
  version.

### Key Entities

This specification introduces no domain entities. `Order` and `OrderLineItem` are explicitly
deferred to later specifications. The concepts below exist only to support the foundation.

- **Configuration Set**: The complete set of settings the service recognises, each with a
  name, an expected shape, whether it is required, and a default where one is safe.
- **Migration Ledger**: The record, held in the database, of which versioned migrations have
  been applied, used to decide what remains pending.
- **Health Report**: The observable summary of whether the service is running and whether its
  database is reachable.
- **Scheduled Task Registration**: The placeholder recurring task, its configured interval,
  and the evidence it emits when it runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer who has never seen the repository goes from clone to a healthy
  running service in under 10 minutes, using only the documented commands.
- **SC-002**: 100% of documented commands succeed on a clean clone at the first attempt, with
  zero undocumented manual steps.
- **SC-003**: The full quality and test verification completes in under 2 minutes on a
  standard developer machine, so it is cheap enough to run before every push.
- **SC-004**: 100% of startup attempts with a missing or malformed setting are rejected
  within 5 seconds, naming the offending setting.
- **SC-005**: Running the test suite twice consecutively produces identical results, and every
  test produces the same outcome alone as it does in the full suite.
- **SC-006**: 100% of test runs that execute zero tests are reported as failures.
- **SC-007**: The schema can be rebuilt from empty in a single command, producing an identical
  result on every machine.
- **SC-008**: The placeholder recurring task fires on every configured interval over a
  30-minute observation window, with zero overlapping executions.
- **SC-009**: A developer can identify which command to run for any routine task by reading
  the project documentation alone, without reading source.
- **SC-010**: 100% of shutdown attempts either drain fully within the configured timeout and
  exit zero, or exit non-zero naming the work abandoned. No shutdown leaves the database
  needing recovery on the next start.
- **SC-011**: 100% of log records emitted during a full test run parse as structured records
  without special-case handling, so acceptance tests can assert on named fields rather than
  matching text.

## Assumptions

These are the defaults chosen where the description did not specify. The ones most likely to
warrant challenge are marked as load-bearing.

- **Load-bearing**: The technology stack is not a decision made by this specification. The
  constitution (v2.0.0) already fixes Node.js with NestJS and TypeScript, SQLite as the
  database, and Drizzle as the sole data access layer. This specification treats those as
  inherited constraints and states requirements in terms of observable behaviour instead.
- **Load-bearing**: A minimal HTTP surface consisting of a health check is in scope, because
  without it there is no way to demonstrate that the service runs. No other endpoint is in
  scope.
- **Load-bearing**: Continuous integration pipeline configuration, containerisation, and
  deployment tooling are out of scope for this specification. The commands defined here are
  intended to be callable by a pipeline added later.
- The audience is the development team. There is no end-customer functionality, and therefore
  no authentication, authorisation, or public API surface in scope.
- The service runs as a single process against a single database file, per the constitution's
  scope constraints. Multi-instance concerns are out of scope.
- Local development and automated test execution are the only environments this specification
  targets.
- The health check is unauthenticated, which is acceptable given the local-only scope above.
- The placeholder recurring task is expected to be replaced, not extended, when real
  scheduled work arrives in a later specification.
- Seed and fixture data for domain tables is out of scope, because no domain tables exist yet.
