# Implementation Plan: Linux Runtime Compatibility

**Branch**: `006-linux-runtime-compatibility` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-linux-runtime-compatibility/spec.md`

## Summary

Make a clean Linux checkout runnable without touching a line of domain code. Two startup-path defects
combine to stop the service on Linux, and each is fixed in the one place it already lives:

1. **The source loader.** The scripts that run TypeScript directly (`node -r ts-node/register …`) read the
   project's single `tsconfig.json`, whose module settings are chosen for the compiled build. On Linux
   that loader does not start the process. A loader-scoped `ts-node` block in `tsconfig.json`
   (`module: nodenext`, `moduleResolution: nodenext`) selects resolution appropriate to running sources
   under the current Node runtime. `tsc` ignores that top-level key, so the compiled build is untouched.

2. **The runtime data directory.** `createConnection` today *refuses* to open the database if the
   directory containing it does not exist. On a fresh checkout it never exists — `data/` and the database
   files are gitignored. The fix inverts one branch: instead of throwing when the directory is absent,
   ensure it (recursive `mkdir`), then open as before. Every genuine failure the function already
   surfaces continues to surface.

The whole change is one config block, a handful of lines in `createConnection`, one new integration
test, one documented shell check for the loader on Linux, and two documentation updates. No schema, no
migration, no dependency, no domain behaviour.

Phase 0 spent its effort on two questions: *why* the loader fails on Linux specifically (R1), and
*whether the loader block can disturb the build or the test run on the environment already in use* (R2).
The second matters more than the first: correctness of this feature does not depend on knowing the exact
mechanism of the Linux failure, only on the fix removing it without regressing anything else.

## Technical Context

**Language/Version**: TypeScript 5.9.3 on Node.js ≥ 22, unchanged. The floor is asserted at startup by
`assertSupportedRuntime` and is not touched here.

**Primary Dependencies**: none added, none removed. Adding a dependency to fix a portability defect would
itself signal the change had outgrown its brief. The fix uses `node:fs` (`mkdirSync`), already imported by
`src/database/client.ts`.

**Storage**: none changed. No table, column, index, trigger, or migration. `npx drizzle-kit generate` MUST
continue to report no pending change — the mechanical proof this is not a persistence change in disguise.

**Testing**: Jest 30 with ts-jest against a real SQLite database, per Constitution Principle VI. The new
directory behaviour is exercised by calling `createConnection` directly against a throwaway path, exactly
as `harness.pragmas.spec.ts` already calls it. Note the loader distinction: the test suite runs under
**ts-jest**, not under `-r ts-node/register`, so the suite proves the *code* assembles on Linux but does
not by itself prove the `ts-node/register` loader boots — see R4 for how that gap is closed.

**Target Platform**: Linux added as a first-class runtime, alongside the environment already in use.
Single process, single writer, unchanged.

**Project Type**: web service. This feature touches one production source file, one config file, and docs.

**Performance Goals**: none. This is a correctness/portability fix; no latency or throughput target moves.

**Constraints**: the binding rule is "no domain behaviour change" (spec FR-014) reinforced by the
constitution's persistence and verification principles. The loader block must be invisible to `tsc`
(build and `--noEmit` check); the directory fix must preserve every existing failure outcome and the
required connection pragmas; relative-path resolution must stay working-directory-relative (spec FR-013,
resolved in clarification) so no existing launch pattern regresses.

**Scale/Scope**: one production file (`src/database/client.ts`), one config file (`tsconfig.json`), one
new test file, `README.md`, and the integration-test `README.md`'s "checks that cannot be automated"
section. Clarifications fixed the directory name as `data/` (no rename) and the verification scope as the
existing suite plus one documented shell check (no CI pipeline).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.1.0**.

| Principle | Verdict | Basis |
| :--- | :--- | :--- |
| I. Centralized State Machine | **PASS** | No status, transition, or state logic is read or written. Nothing in this feature is aware orders exist |
| II. Lock-Free Atomic Transitions | **PASS** | No status write, no predicate, no changed-row count. The fix runs before any statement executes |
| III. Bounded Background Processing | **PASS** | The scheduler is untouched. Directory creation happens once at connection time, not in any loop or tick |
| IV. Exact-Integer Money and Immutable History | **PASS** | No monetary value and no historical row is read, written, or derived |
| V. Two-Phase Keyset Reads | **PASS** | No listing, cursor, or ordering column. No timestamp handling |
| VI. Integration-Proven Verification | **PASS** | The new directory behaviour is proven against a real database, isolated, with its own throwaway path cleaned up after (spec FR-018–FR-020, FR-022). Removing the `mkdir` MUST turn the suite red (FR-023), added to the mutation sweep. The one part that genuinely cannot be automated from inside a ts-jest suite — the `ts-node/register` boot — is documented as a shell check on the target platform rather than faked, following the precedent this repo already set for signal-driven shutdown (R4) |
| Scope: single currency | **PASS** | Not touched |
| Scope: Drizzle as sole persistence path | **PASS** | `mkdirSync` is a filesystem call, not a persistence path. No raw driver handle, no query builder, no ad hoc SQL is introduced. Drizzle remains the only way rows are read or written |
| Scope: single-file / single-process | **PASS** | Reinforced, not changed. The fix makes the single file's directory exist; it does not add an instance, a writer, or a scheduler |
| Workflow: build fails on zero tests | **PASS** | `passWithNoTests: false` unchanged |
| Workflow: committed drizzle-kit migration for any schema change | **PASS (vacuous)** | There is no schema change, so there is nothing to migrate |

**Gate result: PASS, with no recorded deviation.** Complexity Tracking below is empty and says so.

Two things are worth stating rather than leaving a reviewer to reconstruct.

**The loader block is deliberately in `tsconfig.json`, not a new file.** ts-node reads the top-level
`ts-node` key from the tsconfig it loads; `tsc` ignores unknown top-level keys. Putting the override there
is what makes "fix the loader" and "leave the build untouched" the same edit rather than two competing
ones. `tsconfig.build.json` extends `tsconfig.json`, so it inherits the key too — and inheriting an
ignored key is a no-op (R2).

**The directory fix converts an existing branch, it does not add a new responsibility.** `createConnection`
already contains directory-existence logic today — it throws when the directory is missing. The change
replaces the throw with a create. The function's contract ("give me a working connection or a
`DatabaseUnavailableError` that says why") is unchanged; one previously fatal precondition becomes one the
function resolves itself.

## Project Structure

### Documentation (this feature)

```text
specs/006-linux-runtime-compatibility/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── startup.md       # Phase 1 output: the startup contract for loader + data directory
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
tsconfig.json                              # add the loader-scoped `ts-node` block
src/database/client.ts                     # createConnection: ensure the directory instead of rejecting

test/integration/
└── connection.directory.spec.ts           # NEW: directory created / idempotent / :memory: / failure surfaced

README.md                                  # document that DATABASE_PATH resolves relative to the working dir
test/integration/README.md                 # add the ts-node/register Linux boot to the documented shell checks
```

**Structure Decision**: no new module, no new directory. The two fixes live where their concern already
lives — the loader config in `tsconfig.json`, the directory precondition in `createConnection`. The new
test sits at the top level of `test/integration/` beside the other connection-level tests
(`harness.pragmas.spec.ts` proves the pragmas on a real connection; this one proves the directory
handling on a real connection), rather than in a folder of its own, because it is more of the same kind
of test and a reviewer should find connection behaviour in one place.

## Phase 1 Design

The directory branch, stated once here so the tasks do not re-derive it:

```text
createConnection(databasePath):
    if databasePath != ':memory:':
        directory = dirname(databasePath)
        try: mkdir directory, recursive          # was: if not exists -> throw
        except cause: throw DatabaseUnavailableError(databasePath, cause)
    open database, apply pragmas                  # unchanged, including its own try/catch
    return connection
```

- **Recursive** creates missing parents (spec FR-006), and is a no-op when the directory already exists,
  which makes it idempotent (FR-007). An existing directory's contents are never touched.
- **`:memory:` is excluded** by the same guard that excludes it today (FR-008); no directory is created for
  it.
- **A genuine failure** — a permission denial, or a non-directory file where the directory should be —
  throws from `mkdirSync` and is wrapped in the existing `DatabaseUnavailableError`, so startup fails with
  the same `startup.database_unavailable` outcome `main.ts` already maps, with the directory cause named
  (FR-009). The pragmas and the present-but-unwritable-file failure are downstream of this and unchanged
  (FR-010).

The loader block, added to `tsconfig.json` alongside `compilerOptions`:

```jsonc
"ts-node": {
  "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext" }
}
```

R1 records the leading mechanism and the confirmation owed on Linux; R2 records why this cannot reach the
build or the type-check, and what must be re-run on the existing OS to prove the suite and scripts still
pass.

**Output**: [research.md](research.md), [data-model.md](data-model.md),
[contracts/startup.md](contracts/startup.md), [quickstart.md](quickstart.md)

## Constitution Re-check (post-design)

Unchanged: **PASS**. The design adds no persistence path, no dependency, no module, no schema, and no
domain logic. The one behavioural change — a missing data directory is created rather than rejected — is
proven by a real-database integration test whose removal turns the suite red, and is isolated and
self-cleaning. The one honest verification gap — the `ts-node/register` boot, which a ts-jest suite cannot
exercise — is documented as a shell check on the target platform, matching this repository's existing
practice rather than inventing a new one.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. This section is intentionally empty.

Spec 002 recorded one deviation; Specs 003, 004, and 005 recorded none, and neither does this one. It
converts a fatal precondition into a resolved one and adds a loader setting the build never sees — the
kind of change that removes a failure mode without adding a capability.
