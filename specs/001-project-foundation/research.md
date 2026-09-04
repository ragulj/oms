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

**Decision: UNRESOLVED (NEEDS CLARIFICATION).** Three viable options, each with a real defect.
A recommendation is given, but the deciding facts require an install to confirm, and this is a
planning phase.

### What Drizzle actually supports

Read from `npm view drizzle-orm exports`. The SQLite-family driver exports are
`better-sqlite3`, `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `libsql`, `op-sqlite`,
`prisma/sqlite`, and `sqlite-proxy`. **There is no `node:sqlite` driver export.** Ruling out
Bun, Expo, React Native, Cloudflare Durable Objects, and Prisma leaves three candidates.

Peer dependency ranges from `npm view drizzle-orm peerDependencies` confirm
`better-sqlite3 >= 7` and `@libsql/client >= 0.10.0` are both accepted by `drizzle-orm@0.45.2`.

### Option A: `better-sqlite3@13.0.3`

Real SQLite, synchronous, and the most widely used Drizzle SQLite driver. `engines` is
`node >= 22`, satisfied.

The problem is installation. `npm view better-sqlite3 scripts` returns no `install` or
`postinstall` script, `optionalDependencies` is empty, and the only runtime dependency is
`node-addon-api@^8`. The GitHub release for `v13.0.3` returned HTTP 200 but its payload
contains no downloadable archive URLs. Taken together, installing this package appears to
require a `node-gyp` source build, which needs Python and a C++ toolchain that this machine
does not have.

Flagging honestly: this contradicts better-sqlite3's long-standing practice of shipping
prebuilds through `prebuild-install`, so either the packaging changed in v13 or the registry
metadata is not telling the whole story. Treat it as a strong signal, not a settled fact.

**Verification**: attempt the install and observe whether it fetches a binary or invokes
node-gyp.

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

### Recommendation

**Option C, contingent on confirming transaction support**; fall back to **Option A** if
better-sqlite3 turns out to install from a prebuild after all.

Rationale: C is the only option that satisfies both hard constraints at once, real SQLite for
the constitution and no native compilation for this machine. B is the easiest to install and
the one I would reject last, because trading the constitution's named engine for installation
convenience is the kind of decision that looks reasonable now and expensive in spec 003.

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

**Decision: UNRESOLVED (NEEDS CLARIFICATION).**

The registry's current `typescript` is `7.0.2`, a major rewrite of the compiler. NestJS
declares no TypeScript peer dependency, so nothing in the dependency graph constrains the
choice or would warn on a bad one.

NestJS 12 relies on legacy decorators and `emitDecoratorMetadata` to drive dependency
injection. Whether TypeScript 7 preserves that emit behaviour unchanged cannot be established
from package metadata, and getting it wrong produces failures that surface as confusing
runtime injection errors rather than compile errors.

**Rationale for leaving it open**: pinning `^5` would probably work and would be the safe
guess, but it is still a guess, and FR-024 requires the strictest supported type checking,
which makes the compiler version a correctness input rather than a preference.

**Verification**: scaffold a trivial NestJS module with constructor injection, compile under
each candidate, and confirm the injected dependency resolves at runtime.

---

## R3: Node.js version floor

**Decision: Node 20 is the documented minimum; develop against Node 24.**

**Rationale**: `@nestjs/core@12.0.1` declares `engines.node >= 20`, which is the only
authoritative constraint in the dependency graph. The host runs 24.19.0.

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

## Open questions carried out of Phase 0

| # | Question | Why it is unresolved | How to resolve |
|---|----------|----------------------|----------------|
| 1 | SQLite driver (R1) | Deciding facts need an install; one option carries a constitutional question | Attempt the better-sqlite3 install; verify `sqlite-proxy` transaction support |
| 2 | TypeScript major version (R2) | NestJS 12 decorator metadata behaviour under TS 7 is unverifiable from metadata | Compile a trivial injected module under each |
| 3 | Runtime latency and throughput targets | No domain endpoint exists in 001 to measure | Defer to the first domain spec |

Questions 1 and 2 must be settled before implementation begins, because each is expensive to
reverse once code depends on it. Question 3 is correctly deferred: inventing a latency target
for a service with no domain endpoint would produce an untestable acceptance criterion.

### Closed since the first Phase 0 run

The 2026-09-05 clarification round settled three questions this document previously carried.

| Was | Now |
|-----|-----|
| Node floor, coupled to the driver decision | Decoupled. FR-003 specifies a derivation rule, so the floor follows whatever the dependency graph requires |
| Drain timeout default | Ten seconds (FR-033) |
| Heartbeat interval default | Five minutes (FR-029), with tests required to override it and SC-008 rewritten in intervals |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `sqlite-proxy` cannot express per-chunk transactions | Would break Constitution III in spec 003, after the foundation is built on it | Verify transaction support before committing to Option C, not after |
| better-sqlite3 requires a source build on this host | Blocks Option A entirely on the current machine | Install Python and MSVC build tools, or choose another option |
| Choosing libsql without an amendment | Silent drift from a constitution that names SQLite | Treat Option B as requiring an explicit amendment, not a judgement call |
| TypeScript 7 breaks NestJS decorator metadata | Confusing runtime injection failures rather than compile errors | Verify before pinning; prefer the version that demonstrably works |
