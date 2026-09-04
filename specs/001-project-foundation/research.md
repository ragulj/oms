# Phase 0 Research: Project Foundation

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-05

## Method

Every version and capability claim below was resolved against the live npm registry, the
GitHub releases API, or by executing a probe on the development host. Nothing here is recalled
from training data. Where a question could not be settled without installing packages, which
is out of scope for a planning phase, it is left explicitly unresolved rather than guessed.

## Verified environment facts

| Fact | Value | How verified |
|------|-------|--------------|
| Node runtime | `v24.19.0` | `node --version` |
| Node ABI | `137` | `node -p process.versions.modules` |
| npm | `11.17.0` | `npm --version` |
| Platform | Windows 11, `win32-x64` | host |
| Python on PATH | **absent** | `python --version` returns the Microsoft Store alias stub |
| Built-in SQLite | `node:sqlite`, SQLite **3.53.3** | executed a probe: created a table, inserted, read `sqlite_version()` |
| NestJS Node floor | `>= 20` | `npm view @nestjs/core engines` |

The absent Python is not a footnote. It means `node-gyp` cannot compile a native addon from
source on this machine, so any dependency without a usable prebuilt binary simply will not
install. That single fact reshapes the driver decision below.

---

## R1: SQLite driver selection

**Decision: `better-sqlite3@13.0.3`. RESOLVED 2026-09-05 by experiment.**

This section originally recorded three options each carrying a real defect, and recommended
Option C. **The experiment overturned that.** Option A carries none of the defects attributed
to it, which makes Options B and C moot rather than merely second choice.

### What Drizzle actually supports

Read from `npm view drizzle-orm exports`. The SQLite-family driver exports are
`better-sqlite3`, `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `libsql`, `op-sqlite`,
`prisma/sqlite`, and `sqlite-proxy`. **There is no `node:sqlite` driver export.** Ruling out
Bun, Expo, React Native, Cloudflare Durable Objects, and Prisma leaves three candidates.

Peer dependency ranges from `npm view drizzle-orm peerDependencies` confirm
`better-sqlite3 >= 7` and `@libsql/client >= 0.10.0` are both accepted by `drizzle-orm@0.45.2`.

### Option A: `better-sqlite3@13.0.3` — SELECTED

Real SQLite, synchronous, and the most widely used Drizzle SQLite driver. `engines` is
`node >= 22`.

**Correction to the original analysis.** This section previously concluded that installation
would require a `node-gyp` source build, reasoning from three registry signals: no `install`
script, empty `optionalDependencies`, and a GitHub release whose payload carried no
downloadable archives. That inference was wrong. The package ships prebuilt binaries **inside
the npm tarball itself**, in a `prebuilds/` directory covering eight platform targets:
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `linuxmusl-arm64`, `linuxmusl-x64`,
`win32-arm64`, `win32-x64`. No `prebuild-install`, no GitHub release assets, no toolchain. The
missing Python on this host is simply irrelevant.

**Verified by experiment**, because installing is not the same as working:

| Check | Result |
|-------|--------|
| Install on win32-x64, Node 24 | 2 packages in 2 seconds, no node-gyp invocation |
| Loads and executes | Yes |
| Engine reported | SQLite **3.53.4**, genuine SQLite rather than a fork |
| `journal_mode = WAL` | Applies (Constitution, Scope) |
| Changed-row count | `changes = 1` (Principle II) |
| Native transactions | Works (Principle III) |

**Consequence for FR-003**: `engines.node >= 22` is now the highest floor among direct
dependencies, above NestJS's `>= 20`. The derived minimum therefore becomes **Node 22**. The
derivation rule handled this without needing a separate decision, which is what it was for.

### Option B: `@libsql/client@0.18.0`

Async, a first-class Drizzle driver, and it depends on `libsql@^0.5.28`, a napi-rs package
that distributes prebuilt per-platform binaries. No local toolchain required, so it installs
cleanly on this host.

The problem is governance, not engineering. libSQL is a SQLite-compatible **fork**, not
SQLite. Constitution v2.0.0's Scope section names SQLite, and Principle VI requires tests to
run against "a real SQLite database". Choosing this driver means the engine under test is not
the engine the constitution names. That is a constitutional amendment or a written
justification, not a quiet implementation detail.

### Option C: `node:sqlite` via Drizzle's `sqlite-proxy`

Verified working on this host: Node 24.19.0 ships `node:sqlite` backed by real SQLite 3.53.3.
A probe created a table, inserted a row, and read back `changes = 1`, which confirms the
changed-row count that Constitution Principle II depends on for its 409 decision.

This gives real SQLite, zero dependencies, zero compilation, and no supply-chain surface.
Drizzle reaches it through `drizzle-orm/sqlite-proxy` plus `drizzle-orm/sqlite-proxy/migrator`.

The problem is that `sqlite-proxy` is Drizzle's bring-your-own-driver escape hatch rather than
a first-class driver. It needs a thin adapter, it is a less-travelled path, and, most
importantly, **its transaction support needs verification**. Constitution Principle III
requires each background chunk to commit in its own transaction, so a proxy driver that cannot
express transactions properly would fail a core principle later, in spec 003, long after this
decision is cheap to reverse.

### Outcome

Option A satisfies every constraint simultaneously, so the tradeoff this section was built
around does not exist. Real SQLite means **no constitutional amendment is needed**. Prebuilt
binaries mean the toolchain constraint is void. Native transactions mean the `sqlite-proxy`
risk that made Option C conditional never has to be tested.

Options B and C were left in this document rather than deleted, because the reasoning that
made them plausible is worth keeping: if a future platform lacks a prebuild, Option C is the
fallback that preserves real SQLite, and Option B remains available at the cost of an
amendment.

### Alternatives considered and rejected

| Alternative | Rejected because |
|-------------|------------------|
| `bun-sqlite` | Requires the Bun runtime; the constitution fixes Node.js. |
| `expo-sqlite`, `op-sqlite` | Mobile runtimes, no server story. |
| `durable-sqlite` | Cloudflare Durable Objects; conflicts with the single-process local scope. |
| `prisma/sqlite` | Introduces a second persistence toolchain, violating FR-014's single access path. |
| `@libsql/client-wasm` | WASM build carries the fork problem of Option B plus a performance penalty and no compensating benefit. |

---

## R2: TypeScript major version

**Decision: `typescript@5.9.3`. RESOLVED 2026-09-05 by experiment.**

TypeScript 7 was tested and **works**: a real `NestFactory.createApplicationContext` with
constructor injection resolved correctly under TS 7.0.2, so the decorator metadata concern
below turned out to be unfounded. It was rejected on ergonomics, not capability.

TS 7 removed `moduleResolution: node10`, which is what NestJS tooling generates:

| Compiler | Config | Result |
|----------|--------|--------|
| 5.9.3 | `commonjs` + `node` (NestJS default) | Clean compile |
| 7.0.2 | `commonjs` + `node` | Fails, option removed |
| 7.0.2 | `preserve` + `bundler` | Clean compile |
| 7.0.2 | `nodenext` + `nodenext` | Clean compile |

**Rationale**: every NestJS scaffold, document, and Jest preset assumes the classic
configuration. Diverging from it costs more setup friction than the faster compiler returns on
a project whose entire purpose is a low-friction foundation. One surface also remains
untested: `ts-jest` against TS 7, which FR-016 depends on.

**Alternatives considered**: TypeScript 7 with `nodenext/nodenext`, which is proven viable and
is the configuration to use if the project later wants the native-port compiler.

### Original analysis, retained

The concern that drove this question, now resolved:

The registry's current `typescript` is `7.0.2`, a major rewrite of the compiler. NestJS
declares no TypeScript peer dependency, so nothing in the dependency graph constrains the
choice or would warn on a bad one.

NestJS 12 relies on legacy decorators and `emitDecoratorMetadata` to drive dependency
injection. Whether TypeScript 7 preserves that emit behaviour unchanged cannot be established
from package metadata, and getting it wrong produces failures that surface as confusing
runtime injection errors rather than compile errors.

That concern proved unfounded. The verification described here was carried out, and TS 7 emits
`design:paramtypes` correctly and drives NestJS injection without incident.

---

## R3: Node.js version floor

**Decision: Node 22 is the documented minimum; develop against Node 24.**

**Rationale**: FR-003's rule takes the highest floor among direct dependencies. Two declare
one: `@nestjs/core@12.0.1` requires `>= 20`, and `better-sqlite3@13.0.3` requires `>= 22`. The
driver therefore sets the floor at **Node 22**. The host runs 24.19.0, which satisfies it.

This number was Node 20 before the driver was chosen. It moved without anyone deciding it
should, which is the derivation rule working as intended.

**Updated 2026-09-05 after clarification.** FR-003 now specifies a derivation rule rather than
a number: the documented floor is the highest minimum required by any direct dependency,
recomputed whenever dependencies change. This **decouples the floor from the driver decision**.
The earlier version of this section warned that the two had to be decided together, because
Option C requires `node:sqlite`, which Node 20 does not provide. Under the rule that is no
longer a separate decision: choosing Option C simply raises the derived floor automatically.

**Alternatives considered**: pinning to Node 24 only. Rejected as needlessly restrictive for
a floor that FR-003 asks to be documented and enforced, unless R1 forces it.

---

## R4: Test runner

**Decision: Jest `30.5.1`, configured to run test files serially.**

**Rationale**: it is the NestJS scaffolding default, so it needs no additional wiring, and it
already fails a run that matches zero tests, which is what FR-019 requires. Serial execution
was settled during clarification: SQLite admits one writer, so parallel workers sharing a
database would surface lock contention as intermittent failures indistinguishable from real
defects.

**Alternatives considered**: Vitest `5.0.0`. Faster and a nicer configuration story, but it
means diverging from the NestJS default toolchain for a suite whose runtime budget (SC-003,
under 2 minutes) is not under threat. The speed advantage is spending complexity to solve a
problem this project does not have.

**Amended 2026-09-05 during implementation**: Jest must be launched with
`--experimental-vm-modules` because NestJS 12 is ESM-only. See R9. Vitest would not have needed
this, which is a point in its favour that was not visible when this decision was made. It does
not reverse the decision: the measured suite runs in about 12 seconds against a 2-minute
budget, so the cost is one flag rather than an ongoing problem.

---

## R5: Migration tooling can satisfy Constitution IV

**Decision: drizzle-kit `0.31.10` is sufficient. No supplementary migration tool needed.**

**Rationale**: Constitution Principle IV requires historical line-item immutability enforced at
the database level by a trigger calling `RAISE(ABORT)`, not by application code. drizzle-kit
generates plain `.sql` migration files, so hand-written DDL including `CREATE TRIGGER` can be
added to a generated migration and committed alongside it. This obligation belongs to a later
spec, but the foundation had to leave it possible, and it does.

**Alternatives considered**: adding a separate migration runner for raw SQL. Rejected as a
second toolchain doing what the first already does.

---

## R6: Changed-row count is available (Constitution II)

**Decision: satisfied by every candidate driver. Retained as a hard filter on R1.**

**Rationale**: Principle II decides HTTP 409 from the number of rows a conditional update
changed. A driver that hides that count would make the principle unimplementable. Verified
directly for Option C, where `node:sqlite`'s `.run()` returned `changes = 1`. Options A and B
both expose it and are first-class Drizzle drivers, which surfaces it through Drizzle's own
result type.

---

## R7: Scheduler and overlap prevention

**Decision: `@nestjs/schedule@12.0.1`.**

**Rationale**: peer range is `@nestjs/core` v11 or v12, satisfied by the pinned 12.0.1. It
supports interval-based registration, which FR-026 needs, and gives named access to registered
jobs so an overlap guard can be implemented for FR-028.

Worth stating plainly: `@nestjs/schedule` does **not** prevent overlapping executions on its
own. A tick that outruns its interval will be started again concurrently. FR-028 therefore
requires an explicit guard in application code, not a configuration flag. This is the same
concern Constitution Principle III raises about the iteration cap, and it is easy to assume
the framework handles it.

**Alternatives considered**: a raw `setInterval`. Rejected because it offers no lifecycle
integration with Nest's shutdown hooks, which FR-034 needs to stop scheduling during a drain.

---

## R8: Graceful shutdown

**Decision: Nest's built-in shutdown hooks, explicitly enabled.**

**Rationale**: FR-032 through FR-034 require draining in-flight work, stopping new scheduled
executions, closing the database, and force-exiting on timeout. Nest's lifecycle hooks give
ordered teardown across modules, which is what makes "stop the scheduler, then drain requests,
then close the database" expressible in the right order. Shutdown hooks are opt-in and silently
do nothing if not enabled, which is a common and hard-to-notice omission.

**Resolved 2026-09-05**: the drain timeout defaults to ten seconds (FR-033). The reasoning was
not a measured workload, which still does not exist, but a bound: the longest unit of in-flight
work spec 001 can produce is a health request plus an instantaneous heartbeat, so ten seconds
is generous by orders of magnitude while still making a hang obvious.

---

## R9: NestJS 12 is ESM-only

**Decision: keep the project CommonJS; run Jest under `--experimental-vm-modules`.**
Discovered during implementation on 2026-09-05, not during Phase 0.

Every `@nestjs/*` package at v12 declares `"type": "module"`, verified by reading
`node_modules/@nestjs/{common,core,testing,platform-express,schedule}/package.json`. There is
no CommonJS build.

**Why this did not surface earlier.** The Phase 0 probe compiled a NestJS module to CommonJS
and ran it with plain `node`, which succeeded. Node 24 supports `require(esm)` natively
(`process.features.require_module === true`), so a CommonJS build importing an ESM package
works at runtime. The probe was correct and the conclusion drawn from it was correct. It was
simply not the whole surface.

**Where it does bite.** Jest maintains its own module registry and gates `require(esm)` behind
two conditions in `jest-runtime`: `supportsSyncEvaluate` (Node 24.9+ **and** VM modules
enabled) and `shouldLoadAsEsm`. Without the flag, 9 of 18 test suites failed to load with
`Must use import to load ES Module`.

**Resolution**: the test command is
`node --experimental-vm-modules node_modules/jest/bin/jest.js`, invoked that way rather than
through `cross-env` so it works identically on Windows and POSIX with no extra dependency.

**Alternatives considered**:

| Alternative | Rejected because |
|-------------|-------------------|
| Convert the project to ESM (`"type": "module"`) | Larger change, and ESM plus `experimentalDecorators` plus ts-jest is a more fragile combination than one Node flag |
| `transformIgnorePatterns` to transpile `@nestjs/*` to CommonJS | Transforming `node_modules` on every run is slow and fragile |
| Downgrade to NestJS 11 | Trades a working flag for an older framework and unknown other differences |

**Note for later specs**: this is the same class of surface as R2's untested `ts-jest`
compatibility. Any new tool with its own module loader (a coverage reporter, a different test
runner, a bundler) needs checking against ESM-only NestJS before adoption.

## Open questions carried out of Phase 0

| # | Question | Why it is unresolved | How to resolve |
|---|----------|----------------------|----------------|
| 1 | SQLite driver (R1) | Deciding facts need an install; one option carries a constitutional question | Attempt the better-sqlite3 install; verify `sqlite-proxy` transaction support |
| 2 | TypeScript major version (R2) | NestJS 12 decorator metadata behaviour under TS 7 is unverifiable from metadata | Compile a trivial injected module under each |
| 1 | Runtime latency and throughput targets | No domain endpoint exists in 001 to measure | Defer to the first domain spec |

One question remains, and it is correctly deferred: inventing a latency target for a service
with no domain endpoint would produce an untestable acceptance criterion.

### Closed since the first Phase 0 run

| Was | Now | Closed by |
|-----|-----|-----------|
| SQLite driver | `better-sqlite3@13.0.3` | Experiment, 2026-09-05 |
| TypeScript major version | `typescript@5.9.3` | Experiment, 2026-09-05 |
| Node floor, coupled to the driver | **Node 22**, derived automatically once the driver was chosen | FR-003 rule plus the driver decision |
| Drain timeout default | Ten seconds (FR-033) | Clarification |
| Heartbeat interval default | Five minutes (FR-029), tests override it, SC-008 rewritten in intervals | Clarification |

## Risks

| Risk | Status | Impact | Mitigation |
|------|--------|--------|------------|
| `sqlite-proxy` cannot express per-chunk transactions | **Void** | n/a | Option C not selected; `better-sqlite3` has native transactions |
| better-sqlite3 requires a source build | **Void** | n/a | Disproven; prebuilt binaries ship in the npm tarball |
| Choosing libsql without an amendment | **Void** | n/a | Option B not selected; the engine is genuine SQLite |
| TypeScript 7 breaks NestJS decorator metadata | **Void** | n/a | Disproven by experiment; TS 5.9.3 selected on ergonomics instead |
| A future platform target has no prebuilt binary | **Live** | Install fails on that platform | Option C in R1 is the fallback that preserves real SQLite |
| `ts-jest` compatibility with TS 7 never tested | **Live but dormant** | Would matter only if the project later moves to TS 7 | Test before any TS 7 migration; FR-016 depends on it |
| A tool with its own module loader cannot require ESM-only NestJS | **Live, and it already fired once** | Cost 9 of 18 suites until the Jest flag was added (R9) | Check any new runner, bundler, or coverage tool against ESM-only NestJS before adopting it |
