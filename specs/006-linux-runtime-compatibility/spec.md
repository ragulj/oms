# Feature Specification: Linux Runtime Compatibility

**Feature Branch**: `006-linux-runtime-compatibility`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Create Spec 006: Linux Runtime Compatibility. Issue discovered during Linux
testing: the application creates or requires a `.data` directory for local runtime/database data; the
application fails to run on Linux with the current TypeScript/ts-node configuration; adding a ts-node
compiler configuration (`module: nodenext`, `moduleResolution: nodenext`) allows it to run on Linux.
The specification should address reliable application startup on Linux, correct creation and handling of
the required runtime data directory, cross-platform path and filesystem behavior, the correct ts-node
configuration for the project's runtime module system, preservation of existing build and test behavior on
other supported environments, and verification through appropriate tests or runtime checks. Do not change
domain behavior or business functionality."

## Problem

The service was developed and exercised on one operating system and does not start on Linux. Two distinct
defects, both on the startup path and neither touching business behaviour, combine to make a clean Linux
checkout non-runnable. An operator who clones the repository, installs dependencies, and follows the
documented start procedure gets a process that never reaches the point of serving requests.

**Defect one — the TypeScript loader.** The service is started in development and for its operational
scripts by loading TypeScript sources directly, without a prior compile step. That loader reads the
project's single TypeScript configuration, which declares a module system and resolution strategy chosen
for the compiled build. On Linux, that combination does not load the entry module, and the process exits
before the application is constructed. The compiled build path is unaffected — it never runs the loader —
so the failure is invisible to anyone who only ever builds and runs the compiled output, and it surfaces
only when sources are executed directly, which is exactly what development and the project's helper
scripts do. A loader-scoped configuration override that selects the module system and resolution strategy
appropriate to running sources under the current Node runtime removes the failure, and does so without
altering the configuration the compiled build consumes.

**Defect two — the runtime data directory.** The service persists to a single database file whose path is
supplied by configuration and defaults to a file inside a local runtime data directory. That directory,
and the database files within it, are deliberately excluded from version control, so a fresh checkout on
any operating system does not contain it. The startup path today does not create the directory; it checks
whether the directory exists and, if it does not, refuses to open the database and reports the database as
unavailable. On the machine where the service was developed the directory already existed from earlier
runs, so the check passed and the defect stayed hidden. On a clean Linux checkout the directory is absent,
the check fails, and startup aborts. The service must, on startup, ensure the runtime data directory it
needs is present before it attempts to open the database, so that a first run against a valid but not-yet-
created path succeeds rather than failing on a condition the service is capable of resolving itself.

Neither defect is truly unique to Linux — a clean checkout on any operating system would hit the missing
directory, and the loader misconfiguration is a portability latency rather than a Linux-only fault — but
both were discovered on Linux, both block startup there today, and the correction must make Linux a
first-class supported runtime without regressing the environment already in use.

A third, quieter requirement runs underneath both: paths and filesystem interactions must behave
identically across operating systems. Linux filesystems are case-sensitive and use a different path
separator than the development machine. Any path the service constructs, compares, or creates must be
built through the platform-aware facilities already available to it rather than by assuming one platform's
conventions, so that the same configured path resolves to the same location on every supported system.

## Clarifications

### Session 2026-09-05

- Q: The brief says `.data`; the repo uses `data/`. Which name should the spec target? → A: Keep `data/` — no rename; this is a pure startup fix, the default `DATABASE_PATH`, `.env.example`, and `.gitignore` are unchanged, and `.data` in the brief is treated as informal shorthand.
- Q: How should a relative `DATABASE_PATH` resolve? → A: Keep it working-directory-relative (today's behaviour); document the base rather than changing the resolution anchor, so no launch pattern on the existing OS regresses.
- Q: How is Linux startup verified, given the repo has no CI? → A: Via the existing real-database integration suite only (no CI pipeline is added); the source-loader fix is proven by that suite loading and running on Linux.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The service starts on Linux (Priority: P1)

An operator on Linux clones the repository, installs dependencies, provides a valid configuration, and
runs the documented development start command. The process loads the application sources, constructs the
application, connects to its database, and begins serving. It does not exit during the TypeScript loading
phase.

**Why this priority**: this is the defect the specification exists to fix. Without it there is no running
service on Linux at all, and every other guarantee here is moot. It is independently valuable: an operator
who only needs the service to boot and serve on Linux is fully served by this story alone.

**Independent Test**: on a Linux environment, from a clean checkout, run the documented development start
command against a valid configuration and confirm the process reaches the serving state rather than
exiting during source loading.

**Acceptance Scenarios**:

1. **Given** a clean checkout on Linux with dependencies installed and a valid configuration, **When** the documented development start command runs, **Then** the process loads the entry module, constructs the application, and reaches the state where it serves requests.
2. **Given** the same environment, **When** a project helper script that executes sources directly is run (for example the migration, seed, or documentation-export scripts), **Then** it loads and runs to completion rather than failing during source loading.
3. **Given** the same environment, **When** startup fails for a genuine reason unrelated to source loading (for example an invalid configuration value), **Then** the failure is reported as that genuine reason and not masked or preceded by a source-loading failure.

---

### User Story 2 - The runtime data directory is handled on first run (Priority: P1)

An operator points the service at a database path whose containing directory does not yet exist — the
normal situation on a fresh checkout, because that directory is excluded from version control. On startup
the service ensures the directory is present and then opens the database. The operator does not have to
create the directory by hand as an undocumented prerequisite.

**Why this priority**: a service that boots (Story 1) but then refuses to open its database has not
started in any useful sense. This is the second half of "runs on Linux" and is required for the service to
be usable from a clean checkout. It is separately testable from Story 1 because the directory condition
can be exercised independently of the loader.

**Independent Test**: set the configured database path to a location inside a directory that does not
exist, start the service, and confirm the directory is created and the database opens, with no manual
directory creation step.

**Acceptance Scenarios**:

1. **Given** a configured database path whose containing directory does not exist, **When** the service starts, **Then** it creates the directory (including any missing parent directories) and opens the database successfully.
2. **Given** a configured database path whose containing directory already exists, **When** the service starts, **Then** it opens the database successfully and the pre-existing directory and its contents are left untouched.
3. **Given** a configured database path whose containing directory cannot be created for a genuine reason (for example a permission denial), **When** the service starts, **Then** startup fails with the existing database-unavailable outcome, and the reported cause identifies the directory problem rather than being silently swallowed.
4. **Given** an in-memory database configuration, **When** the service starts, **Then** no directory is created and the service opens the in-memory database as it does today.

---

### User Story 3 - Existing environments and behaviour are preserved (Priority: P2)

An operator on the previously supported operating system, and the project's build and test pipelines,
observe no change. The compiled build produces the same output, the full test suite passes, and every
guarantee the constitution mandates about persistence, money, ordering, and the background job continues
to hold. The only observable difference anywhere is that Linux now works and a first run now creates its
own data directory.

**Why this priority**: the instruction is explicit that domain behaviour and business functionality must
not change, and that build and test behaviour on other supported environments must be preserved. This
story is the evidence for that promise. It is P2 rather than P1 because it protects existing guarantees
rather than delivering the new capability, but a failure here would make the change unacceptable.

**Independent Test**: run the complete pre-existing test suite on the previously supported environment and
confirm it passes unchanged; produce the compiled build and confirm it is unaffected by the loader-scoped
configuration.

**Acceptance Scenarios**:

1. **Given** the previously supported operating system, **When** the documented development start command runs, **Then** the service starts exactly as it did before this change.
2. **Given** the compiled build command, **When** it runs on any supported environment, **Then** the compiled output and its behaviour are unchanged by the loader-scoped configuration override, because the build does not consume that override.
3. **Given** the full pre-existing test suite, **When** it runs on a supported environment, **Then** it passes without modification to any existing test's expectations, and the suite still fails the build if zero tests run.
4. **Given** any domain operation — order creation, status transition, listing, background promotion — **When** it is exercised after this change, **Then** its outcome is identical to before, because no domain code path is touched.

---

### Edge Cases

- **The configured database path is a bare filename with no directory component.** The service resolves it against a well-defined base and ensures the resulting containing directory exists, rather than assuming the current working directory is writable or already correct.
- **The containing directory exists but the database file does not.** Only the file is created (as the database engine already does); the directory is left as found.
- **Two service actions race to create the same missing directory.** Directory creation is treated as idempotent: a directory that already exists when creation is attempted is a success, not an error, so a concurrent or repeated startup does not fail on "already exists".
- **The path separator differs between operating systems.** A configured path expressed with one platform's separator, or resolved on another platform, designates the same location; the service does not hard-code a separator when constructing or comparing paths.
- **A path differing only in letter case.** On a case-sensitive filesystem, two paths differing only in case are two different locations; the service does not rely on case-insensitive matching to find its data directory, migrations, or any other path-addressed resource.
- **The loader-scoped configuration is applied but a dependency genuinely fails to resolve.** The failure is reported as a real module-not-found for the specific dependency, distinguishable from the blanket source-loading failure this change removes.

## Requirements *(mandatory)*

### Functional Requirements

#### Startup under the source loader

- **FR-001**: The service MUST start successfully on Linux when its sources are executed directly through the project's development start command, reaching the state where it serves requests.
- **FR-002**: The project's helper scripts that execute sources directly (migration, seed, and documentation export) MUST load and run to completion on Linux.
- **FR-003**: The source loader MUST use a module system and module-resolution strategy that are correct for running the project's sources under the current Node runtime, independent of the module settings chosen for the compiled build.
- **FR-004**: The loader-scoped configuration MUST NOT alter the configuration consumed by the compiled build. Producing the compiled output MUST yield the same result before and after this change.
- **FR-005**: A startup failure caused by a genuine condition other than source loading (invalid configuration, unreachable database, and the like) MUST continue to be reported as that condition, not masked by, replaced with, or preceded by a source-loading failure.

#### The runtime data directory

- **FR-006**: On startup, before opening the database, the service MUST ensure that the directory containing the configured database file exists, creating it and any missing parent directories if necessary.
- **FR-007**: Directory creation MUST be idempotent: an already-existing directory MUST be treated as success, and its existing contents MUST NOT be modified, moved, or removed.
- **FR-008**: When the configured database path designates an in-memory database, the service MUST NOT create any directory and MUST open the in-memory database as it does today.
- **FR-009**: If the required directory genuinely cannot be created (for example, a permission denial or a conflicting non-directory file at the path), startup MUST fail with the existing database-unavailable outcome, and the reported cause MUST identify the directory problem rather than being discarded.
- **FR-010**: Ensuring the directory MUST NOT weaken any existing startup guarantee: the database connection pragmas the constitution requires MUST still be applied, and a database that is present but unwritable MUST still fail startup as it does today.

#### Cross-platform path and filesystem behaviour

- **FR-011**: Every path the service constructs, resolves, compares, or creates MUST be built through platform-aware path facilities rather than by assuming a specific separator or platform convention, so that a given configured path resolves to the same location on every supported operating system.
- **FR-012**: The service MUST NOT rely on case-insensitive path matching. Any path-addressed resource — the data directory, migration files, and configuration files — MUST be referenced with the exact case it is stored under, so behaviour is identical on case-sensitive and case-insensitive filesystems.
- **FR-013**: A relative configured database path MUST continue to resolve against the process working directory, exactly as it does today. This specification MUST document that base rather than change it, so no existing launch pattern regresses. Given the same working directory, the path MUST resolve to the same location on every supported operating system.

#### Preservation of existing behaviour

- **FR-014**: No domain behaviour or business functionality may change as a result of this specification. Order creation, status transitions, listing, monetary handling, ordering, and background promotion MUST all behave exactly as before.
- **FR-015**: The single persistence path through the established ORM MUST remain the only persistence path. This change MUST NOT introduce a raw driver handle, an alternate query builder, or ad hoc SQL, and MUST NOT alter the database schema or generate a migration.
- **FR-016**: The full pre-existing test suite MUST pass without modifying the expectations of any existing test. If any existing test requires a changed expectation to pass, that MUST be treated as evidence of an unintended behaviour change rather than as a test needing adjustment.
- **FR-017**: Startup behaviour on the previously supported operating system MUST be unchanged, other than the newly added ability to create a missing data directory, which also takes effect there.

#### Verification

- **FR-018**: Ensuring the data directory MUST be exercised by an automated test that starts from a state where the directory does not exist, confirms it is created, and confirms the database opens — run against a real database rather than a mocked persistence layer.
- **FR-019**: The idempotent case (directory already present) and the failure case (directory cannot be created) MUST each be exercised, the latter confirming the failure surfaces as the existing database-unavailable outcome with the directory cause identified.
- **FR-020**: The in-memory case MUST be exercised to confirm no directory is created for it.
- **FR-021**: Startup under the source loader MUST be verified on Linux by the project's existing real-database integration suite: the suite loading and running to completion on Linux is the evidence that direct source loading works there. This specification introduces no continuous-integration pipeline; if one is added later it MUST run this suite on Linux, but no such pipeline may be a precondition for considering the source-loader fix verified.
- **FR-022**: Tests MUST remain isolated and MUST observe only the rows and files they create; a test that creates a directory MUST NOT leave that directory behind in a way that affects another test's outcome.
- **FR-023**: Removing the directory-creation step MUST turn the test suite red, and removing the loader-scoped configuration MUST cause the Linux startup verification to fail. A guarantee whose removal leaves the suite green has no test behind it.

### Key Entities

- **Runtime data directory**: the directory that contains the service's single SQLite database file, designated by the configured database path and excluded from version control. Its presence is a precondition for opening the database; this specification makes the service responsible for ensuring that precondition rather than assuming it.
- **Source loader configuration**: the configuration the direct-source-execution path reads to decide how to interpret and resolve the project's TypeScript modules at runtime. Distinct from, and must not disturb, the configuration the compiled build consumes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean Linux checkout with a valid configuration, the documented development start command brings the service to a serving state in 100% of attempts, with zero manual filesystem preparation steps.
- **SC-002**: On a clean checkout with the configured database directory absent, first startup creates the directory and opens the database with zero manual `mkdir` or equivalent steps.
- **SC-003**: A second and subsequent startup against an existing directory leaves that directory and its contents byte-for-byte unchanged, and still starts successfully.
- **SC-004**: Startup on the previously supported operating system is unchanged: the same command produces the same running service as before this change.
- **SC-005**: The compiled build output is identical before and after this change, confirming the loader-scoped configuration does not reach the build.
- **SC-006**: The complete pre-existing test suite passes on both Linux and the previously supported environment, with no existing test's expectation modified, and the suite still fails the build if zero tests run.
- **SC-007**: Every domain operation produces an identical outcome before and after the change, confirmed by the unchanged domain tests passing.
- **SC-008**: A configured path expressed or resolved on either operating system designates the same location, confirmed on a case-sensitive filesystem.
- **SC-009**: No database migration is generated and no schema change is pending, because this specification touches no stored data or schema.
- **SC-010**: Deleting the directory-creation step turns the suite red, and disabling the loader-scoped configuration turns the Linux startup verification red.

## Assumptions

- **Naming: `data`, not `.data` (resolved in clarification).** The triggering description refers to a `.data` directory; the repository's runtime data directory is `data/` (default `DATABASE_PATH` is `./data/oms.db`), already excluded from version control along with the database files. The clarification confirmed the name stays `data/`: no rename, and no change to the default path, `.env.example`, or `.gitignore`. `.data` in the brief is treated as informal shorthand for the same directory. The specification remains written against "the directory the configured database path designates," so it is correct for any configured path, not only the default.
- **The created directory inherits default filesystem permissions.** No specific mode is mandated; the directory is created with the runtime's default (umask-derived) permissions. The system is unauthenticated within its declared scope, so a restrictive mode would protect little, and imposing one is out of scope for this portability fix.
- **Relative path resolution base is documented, not changed.** A relative `DATABASE_PATH` continues to resolve against the process working directory (FR-013). Anchoring resolution to a fixed root was considered and rejected in clarification because it would change where the database resolves for existing launch patterns, contradicting FR-017.
- **The failure is a startup-path failure, not a domain failure.** Both defects sit strictly before any request is served or any order is processed. No order, transition, listing, money, ordering, or background-job behaviour is in scope, and the instruction to leave domain behaviour untouched is taken as an absolute constraint.
- **The loader override is scoped to running sources directly.** The correction to module resolution applies only to the direct-source-execution path used by development and the helper scripts. The compiled build reads a separate configuration and is deliberately left untouched, which is what makes "preserve existing build behaviour" achievable rather than a tension.
- **The specific known-good loader setting** offered in the description (a loader-scoped `module: nodenext` with `moduleResolution: nodenext`) is recorded as a candidate remedy for the planning phase. This specification states the outcome required (sources load and run on Linux without disturbing the build) rather than mandating that exact setting, so planning may confirm or refine it against the project's Node version and module layout.
- **Directory creation is recursive and idempotent.** Missing parent directories are created, and an already-present directory is a success. This matches the "creates or requires" language in the description and the normal expectation of a first run.
- **The database engine still creates the database file itself.** This change ensures only the containing directory; the file is created by the existing connection code as it is today.
- **No new configuration setting is introduced.** The database path setting already exists and is unchanged; this specification changes what the service does when the path's directory is absent, not how the path is supplied.
- **The single-file, single-writer, single-process stance is unchanged.** This is a portability fix, not a deployment-model change, and nothing here touches the constitution's scope constraints.
- **"Supported environments" means the operating system already in use plus Linux after this change.** No claim is made about operating systems beyond those, and none is required.
