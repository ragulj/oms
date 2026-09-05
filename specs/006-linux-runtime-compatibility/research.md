# Phase 0 Research: Linux Runtime Compatibility

Four questions decide whether the two-line intent of this feature is safe. R1 and R4 concern the loader;
R3 concerns the directory; R2 is the one that protects the environment already in use and matters most.

Where a finding can only be confirmed on Linux, it says so plainly and names the confirmation as an
implementation task rather than asserting it from a Windows workstation.

---

## R1 — Why the source loader fails on Linux, and why `nodenext` fixes it

**Decision**: Add a loader-scoped `ts-node` block to `tsconfig.json` selecting `module: nodenext` and
`moduleResolution: nodenext`. Treat the exact failure mechanism as a hypothesis to be confirmed on Linux
during implementation, not as a precondition for the fix.

**What is known for certain (reported):** on Linux, `node -r ts-node/register src/main.ts` does not bring
the process up under the current configuration, and adding the `nodenext` loader block makes it run. This
is the reporter's observed, reproduced result and is the ground truth this feature is built on.

**Leading mechanism.** The project's `tsconfig.json` sets `moduleResolution: "node"` (the classic /
"node10" algorithm). ts-node, unless given its own block, resolves modules with that algorithm at load
time. The classic algorithm predates the `exports` field in `package.json` and does not honour it. Several
of this project's runtime dependencies expose their entry points *only* through `exports` — most visibly
`drizzle-orm/better-sqlite3`, a subpath with no classic-resolvable file on disk. `nodenext` resolution
honours `exports`, which is why switching the loader to it removes the failure. This is consistent with
the reported fix and with the dependency set.

**Why it surfaces on Linux and (apparently) not on the development machine is left open.** The mechanism
above is not obviously platform-specific, and `npm run check` (which runs `tsc --noEmit` against the same
`moduleResolution: node`) is reported to pass on the development machine — so the failure is in ts-node's
*runtime* load behaviour, not in TypeScript's type-level resolution. Candidate contributors include
case-sensitive path resolution on Linux, and ts-node/Node version interactions around CJS/ESM interop.
Pinning the precise cause is **not required** for correctness: the fix is validated by outcome (the four
loader entry points run on Linux), not by mechanism.

**Rationale**: `nodenext` is the resolution mode that matches how the current Node runtime actually loads
packages, including their `exports` maps. It is strictly more capable than classic resolution for this
dependency set, and — critically — it changes *resolution*, not *emit format*: with no `"type"` field in
`package.json`, the nearest package scope is CommonJS, so `nodenext` still treats `.ts` sources as CJS.
The loader therefore emits the same module kind it does today and merely resolves imports correctly.

**Alternatives considered**:
- *Change `moduleResolution` in the shared `compilerOptions`.* Rejected: it would also change the compiled
  build and the `tsc --noEmit` check, violating spec FR-004. The loader block isolates the change to the
  loader, which is the whole point.
- *Add `"type": "commonjs"` or restructure imports.* Rejected: unnecessary churn across the source tree
  for a problem the loader block solves in four lines, and a `type` field risks its own ESM/CJS surprises.
- *`transpileOnly` for ts-node.* Rejected: it would mask type errors at load time, trading one class of
  latent breakage for another, and does not address `exports` resolution.

**Confirmation owed (implementation task, on Linux)**: after adding the block, run each `ts-node/register`
entry point — `npm run start:dev`, `npm run db:migrate`, `npm run db:seed`, `npm run openapi:check` — and
confirm each loads and runs. Optionally capture the pre-fix error text for the record.

**Confirmation delivered (2026-09-05, Linux, Node 24.20.0) — and the leading mechanism above is wrong.**
All four entry points load and run. But the pre-fix error text, captured as this record asked, was a
*type* error rather than a runtime module-load failure: `TS7016: Could not find a declaration file for
module 'drizzle-orm/sqlite-core'`. Investigating that revealed the real cause. The installed
`drizzle-orm` was incomplete — 108 of an expected 444 `.d.ts` files were present, while all 444 `.js`,
`.cjs` and `.d.cts` files were — so the declaration files its own `exports` map names did not exist on
disk. The same missing declarations broke `tsc` (`npm run build` and `npm run check`) and ts-jest
(`npm test`), which is the tell: a loader-resolution fault could not have reached three independent
toolchains that consume the config differently.

Reinstalling the package cleared all three. With the installation intact, **removing the `ts-node` block
leaves every check green** on Node 22.22.2 and Node 24.20.0 alike — `npm run openapi:check` exits 0 and
`npm run start:dev` reaches `service.started` without it. The block is therefore retained as deliberate
hardening against `exports`-only dependencies, not as the remedy for a reproducible defect; spec FR-003,
FR-023 and SC-010 were amended to match. The alternatives weighed above were weighed against a
misdiagnosis and should not be read as still-live trade-offs.

Two further environmental defects surfaced in the same run and are recorded here so the next reader does
not re-derive them: `@nestjs/testing@12.0.1` is ESM-only, so Jest cannot load the suite below Node 24.9;
and the HTTP test harness never bound its server, so concurrent requests raced on supertest's lazy bind.
Neither is a Spec 006 defect. See `test/integration/README.md`.

---

## R2 — Blast radius of the loader block on the existing environment (build, check, test)

**Decision**: The `ts-node` block is safe to add because every consumer of `tsconfig.json` either ignores
the key or benefits from it. Confirm on the existing OS by running `npm run check` and `npm test` unchanged.

**Who reads `tsconfig.json`, and what the block does to each:**

| Consumer | Reads the `ts-node` key? | Effect of the block |
| :--- | :--- | :--- |
| `tsc -p tsconfig.build.json` (`npm run build`) | No — `tsc` ignores unknown top-level keys | None. Compiled output is byte-for-byte unchanged (spec FR-004, SC-005). The key is inherited via `extends` but inheriting an ignored key is a no-op |
| `tsc --noEmit` (inside `npm run check`) | No | None. Type-checking still uses the shared `compilerOptions` |
| `ts-node/register` (start:dev, migrate, seed, openapi:export/check) | **Yes** | The intended fix: nodenext resolution at load time |
| ts-jest (`npm test`) | No — ts-jest uses `compilerOptions`, not the `ts-node` key | None on transform behaviour |
| Jest loading `jest.config.ts` | Yes — Jest transpiles its TS config through ts-node | nodenext resolution when loading the config; expected to be a no-op or an improvement, never a regression |

**Rationale**: the block is additive and scoped. The only paths whose behaviour changes are exactly the
paths that are broken on Linux today. The build and the type-check are provably out of scope because `tsc`
does not read the key.

**Alternatives considered**: none needed — this is an analysis, not a choice. The residual risk is the
one row that reads the key incidentally (Jest loading `jest.config.ts`), which is why the confirmation
below runs the full test suite rather than reasoning about it.

**Confirmation owed (implementation task, existing OS)**: `npm run check` passes (prettier, eslint,
`tsc --noEmit`, `openapi:check`) and `npm test` runs and passes with no existing expectation modified
(spec FR-016, SC-006). `npm run build` produces unchanged output (SC-005).

---

## R3 — Directory-creation semantics

**Decision**: In `createConnection`, replace the "throw if the directory is absent" branch with a
recursive `mkdirSync`, guarded exactly as the current check is (skip for `:memory:`), and wrap any failure
in the existing `DatabaseUnavailableError`.

**Findings**:
- **Recursive is required and sufficient.** `mkdirSync(dir, { recursive: true })` creates missing parents
  (spec FR-006) and is a no-op when the directory already exists, giving idempotency for free (FR-007)
  without a pre-check. It does not touch an existing directory's contents.
- **`:memory:` must stay excluded.** `dirname(':memory:')` is `.`, which exists, so the current guard
  already avoids acting on it; keeping the guard means no directory is created for an in-memory database
  (FR-008). A bare filename such as `oms.db` has `dirname` `.`, so recursive `mkdir` on `.` is a
  successful no-op — no special case needed.
- **Failure surfaces unchanged.** `mkdirSync` throws `EACCES` on a permission denial and `EEXIST`/`ENOTDIR`
  when a non-directory file occupies the path. Wrapping the throw in `DatabaseUnavailableError` keeps the
  single failure outcome `main.ts` already maps to `startup.database_unavailable`, with the directory
  cause named (FR-009). The subsequent `new Database(...)` and `applyPragmas(...)` are untouched, so the
  pragmas (Constitution scope) and the present-but-unwritable-file failure still behave as today (FR-010).
- **The test suite already performs this workaround, which is the tell.** `test/setup/database.ts`
  exposes `ensureTestDbDir()` (a recursive `mkdirSync`) called from global setup, precisely because
  `createConnection` will not create the directory itself. Once the production code ensures the directory,
  that helper is redundant for correctness. It is **retained** (removing it is out of scope and low value)
  but noted here so a reviewer understands the production fix subsumes it.

**Alternatives considered**:
- *Create the directory in `main.ts` before calling `createConnection`.* Rejected: `migrate.ts` and
  `seed.ts` also call `createConnection`, and tests call it directly; the precondition would have to be
  duplicated at every call site. The precondition already lives inside `createConnection` — as a throw —
  so the fix belongs there.
- *A separate `ensureDataDir` module.* Rejected: a one-line filesystem concern that already has a home
  does not need a module and a seam.

---

## R4 — How the `ts-node/register` boot is verified without CI

**Decision**: Verify in two layers. (a) `npm run openapi:check` — which itself runs through
`node -r ts-node/register` — becomes the automatable exerciser of the loader path and is already part of
`npm run check`. (b) A full `start:dev` boot on Linux is added to the integration-test README's
documented "checks that cannot be automated from inside the suite," alongside the signal-driven-shutdown
check that already lives there.

**Why a new automated test cannot cover the boot from inside the suite.** The Jest suite runs under
ts-jest, not under `-r ts-node/register` (confirmed: `test/setup/test-app.ts` assembles the app in-process
via `AppModule.register`, and the scheduler/config specs use that harness rather than spawning the CLI).
So the suite proves the *code* loads and assembles on Linux — real value — but it does not exercise the
`ts-node/register` loader that this feature fixes. Writing a test that shells out to `node -r
ts-node/register src/main.ts`, waits for a port, and sends a signal would be testing Node's process and
signal behaviour on the platform, which is exactly the reasoning the repo already used to keep
signal-driven shutdown a documented manual check rather than a flaky spawned one.

**Why this satisfies the clarification.** The clarification pinned verification to "the existing
integration suite, no CI pipeline." `openapi:check` is part of the existing `npm run check` gate and runs
the loader path, so a regression that breaks `ts-node/register` resolution is caught by an existing
command on Linux — no pipeline required. The documented `start:dev` check covers the remaining, genuinely
un-automatable slice (a full HTTP boot) honestly rather than with a test that would test the platform.

**Rationale**: this is the established pattern of the codebase (`test/integration/README.md`, "Two checks
that cannot be automated from inside the suite"). Extending it to three keeps verification honest and
consistent instead of introducing either a flaky spawn test or CI tooling the project has chosen not to
have.

**Alternatives considered**:
- *A spawned-subprocess boot test.* Rejected as above — flaky, platform-testing, and against the repo's
  stated precedent.
- *Introduce CI.* Rejected by the clarification; out of scope.

---

## Consolidated decisions

| # | Decision |
| :--- | :--- |
| R1 | Add `ts-node` block (`module`/`moduleResolution`: `nodenext`) to `tsconfig.json`; confirm the four loader entry points on Linux |
| R2 | The block cannot reach the build or type-check (`tsc` ignores the key); confirm suite + check on the existing OS |
| R3 | `createConnection` ensures the directory recursively, guarded for `:memory:`, failures wrapped in `DatabaseUnavailableError`; existing pragmas and failure paths unchanged |
| R4 | Loader boot verified by `openapi:check` (automated, in `npm run check`) plus a documented `start:dev` shell check on Linux |

No open `NEEDS CLARIFICATION` remain. The two confirmations owed (R1 on Linux, R2 on the existing OS) are
implementation-phase verifications, not unresolved design questions.
