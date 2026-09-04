# Quickstart & Validation Guide: Project Foundation

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-05

This guide is how you prove the foundation works end to end. It is a validation guide, not an
implementation guide: it says what to run and what you should see, and leaves how to build any
of it to `tasks.md`.

## A note on command names

No `package.json` exists yet, so the exact script names below are **proposals, not facts**.
FR-001 fixes the nine command *roles* the repository must provide; `/speckit-tasks` assigns the
actual names. Where this guide writes `npm run test`, read it as "the command role named
Run tests".

| Role (FR-001) | Proposed command | Requirement |
|---------------|------------------|-------------|
| Install dependencies | `npm install` | FR-002 |
| Start in development | `npm run start:dev` | FR-004 |
| Build production artifact | `npm run build` | FR-001 |
| Run production build | `npm run start:prod` | FR-001 |
| Apply migrations | `npm run db:migrate` | FR-011 |
| Generate a migration | `npm run db:generate` | FR-012 |
| Run tests | `npm run test` | FR-016 |
| Check code quality | `npm run check` | FR-022 |
| Auto-fix code quality | `npm run fix` | FR-023 |

## Prerequisites

- **Node.js 22 or above.** That floor is derived, not pinned: it is the highest minimum any
  direct dependency requires (FR-003). `better-sqlite3` sets it at 22, above the framework's
  20. Development is against Node 24.19.0.
- **npm**, bundled with Node.
- **No database server to install.** The engine is a single file.
- **No C++ toolchain, and no Python.** The driver ships prebuilt binaries for eight platform
  targets inside its npm package, so nothing compiles from source at install time. This was
  verified rather than assumed.

## Setup

1. Clone the repository.
2. Install dependencies.
3. Copy the committed example settings file to its expected location. The service must then
   start with **no further edits** (User Story 4, scenario 3).
4. Apply migrations. This is a separate, deliberate step: the service refuses to start while
   any migration is pending and will never apply one for you (FR-015).
5. Start the service.
6. Request the health check. It should report healthy.

If any step needs a manual action not written in the project documentation, that is an SC-002
failure, not a quirk of your machine.

## Validation scenarios

Each scenario proves a specific requirement. Run them in any order; they are independent.

### 1. Clone to healthy service (User Story 1, SC-001, SC-002)

Follow Setup on a machine that has never seen the project. Expect a healthy health check
within 10 minutes, with every command succeeding first time.

**Failure signals**: an undocumented step, a command that needs to be run twice, or editing a
source file to make startup work.

### 2. Migrations are reproducible and idempotent (User Story 2, SC-007)

Delete the database file and apply migrations. Expect the schema to be created. Apply them
again and expect a success that changes nothing.

Then start the service against a database with a migration still pending: expect a non-zero
exit that **names the pending migration**, before any request is served.

**Failure signal**: the service starting anyway, or applying the migration itself.

### 3. The test suite is trustworthy (User Story 3, SC-005, SC-006)

- Run the suite twice. Expect identical results.
- Run a single test alone, then as part of the suite. Expect the same outcome both times.
- Point the runner at a selection matching nothing. Expect a **non-zero exit**, not a pass.
- Confirm your working database is untouched afterwards. The suite uses a throwaway database.

**Failure signal**: an empty run reported as success. That is the FR-019 gate failing, and it
is the one that silently invalidates every other test result.

### 4. Configuration fails fast (User Story 4, SC-004)

Remove a required setting and start. Expect a non-zero exit within 5 seconds, naming the
missing setting. Repeat with a setting present but malformed; expect the message to name both
the setting and the expected shape.

**Failure signal**: the service booting and failing later at an unrelated call site.

### 5. Quality gate (User Story 5)

Introduce a deliberate style violation and a deliberate type error. Expect the check command to
report both and exit non-zero. Run the fix command, then re-run the check and expect a pass.
On an unmodified clean clone the check must pass (FR-025).

### 6. Scheduled work runs without overlapping (User Story 6, SC-008)

The default interval is five minutes, which is longer than the whole verification budget, so
**override the interval through configuration** rather than waiting on it (FR-029). Observe at
least six consecutive intervals and expect evidence from every one, with no two executions
overlapping.

**Failure signal**: two executions running concurrently. The scheduling library does not
prevent this on its own; it requires an explicit guard.

### 7. Shutdown drains cleanly (SC-010)

Send a termination signal to a running service. Expect in-flight work to finish, the database
to close, and a zero exit within the ten second default. The database must not need recovery
on the next start.

Then force the timeout to expire with work still running. Expect a non-zero exit that records
what was abandoned.

### 8. Logs are machine-parseable (SC-011)

Capture output from a full test run. Expect every record to parse as a structured record with
no special-case handling, and expect no secret to appear anywhere. The startup record must
confirm the resolved configuration source, database location, applied connection settings, and
registered recurring tasks (FR-031).

## Open decisions

**None that block this guide.** Both items this section previously listed were settled by
experiment on 2026-09-05 and are recorded in [research.md](./research.md):

- **SQLite driver**: `better-sqlite3@13.0.3`. Genuine SQLite 3.53.4, prebuilt binaries, native
  transactions, no constitutional amendment needed.
- **TypeScript**: `5.9.3`, using the NestJS-default compiler configuration.

The only deferred item left in the plan is runtime latency and throughput targets, which
cannot be set until a domain endpoint exists to measure. Nothing in this guide depends on
them.
