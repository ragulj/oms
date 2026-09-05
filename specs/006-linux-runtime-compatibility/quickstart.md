# Quickstart: Validate Linux Runtime Compatibility

Runnable checks that prove the feature end to end. Grouped by what they prove. Commands assume a checkout
with dependencies installed (`npm ci`). See [contracts/startup.md](contracts/startup.md) for the outcome
each check asserts and [research.md](research.md) for why each exists.

## Prerequisites

- Node.js ≥ 22.
- A copy of `.env` (from `.env.example`) or the `DATABASE_PATH` environment variable set.

---

## A. The service starts on Linux (spec US1, FR-001–FR-003)

Run on Linux, from a clean checkout, with the data directory absent:

```bash
rm -rf ./data                 # ensure the runtime data directory does not exist
npm run start:dev
```

**Expected**: the process loads the sources, creates `./data`, connects, and logs `service.started`. It
does **not** exit during source loading. Stop it with Ctrl-C.

The other loader entry points must also load and run (they use the same `-r ts-node/register` path):

```bash
npm run db:migrate
npm run db:seed
npm run openapi:check
```

**Expected**: each runs to completion. `openapi:check` is part of `npm run check`, so it also guards this
path automatically on every check run.

---

## B. The data directory is created on first run (spec US2, FR-006–FR-010)

Point the database at a directory that does not exist and start:

```bash
DATABASE_PATH=./tmp-fresh/oms.db npm run db:migrate
```

**Expected**: `./tmp-fresh` is created (with parents), migrations apply, no manual `mkdir`. Clean up with
`rm -rf ./tmp-fresh`.

Idempotency — run it again against the now-existing directory:

**Expected**: succeeds; the existing directory and its contents are untouched.

In-memory — no directory is created:

```bash
DATABASE_PATH=:memory: npm run start:dev
```

**Expected**: boots against an in-memory database; no directory appears.

The automated equivalent of these cases lives in `test/integration/connection.directory.spec.ts` (created
during implementation) and runs against a real database per Constitution Principle VI:

```bash
npm test -- --testPathPatterns connection.directory
```

**Expected**: passes — covers created / idempotent / `:memory:` / uncreatable-directory-surfaces-failure.

---

## C. Nothing else changed (spec US3, FR-014–FR-017)

On the environment already in use (and on Linux):

```bash
npm run build            # compiled output unchanged (SC-005)
npm run check            # prettier + eslint + tsc --noEmit + openapi:check all pass
npm test                 # full suite passes, no existing expectation modified (SC-006)
npx drizzle-kit generate # reports NO pending change (SC-009)
```

**Expected**: all green; `drizzle-kit generate` prints no new migration.

---

## D. The guarantees are load-bearing (spec FR-023)

Confirm the tests actually hold the behaviour, not just describe it:

- Temporarily remove the recursive `mkdir` from `createConnection` → `npm test` MUST turn red
  (`connection.directory.spec.ts` fails). Restore it.
- Temporarily remove the `ts-node` block from `tsconfig.json` and, on Linux, run `npm run openapi:check`
  → it MUST fail to load. Restore it.

---

## E. Documented check that cannot be automated (see `test/integration/README.md`)

A full HTTP boot under the `ts-node/register` loader on Linux is verified by hand (§A above), recorded in
the integration-test README beside the existing signal-driven-shutdown check. A ts-jest suite cannot
exercise the `ts-node/register` loader (it transforms with ts-jest), so this slice is documented honestly
rather than faked — see [research.md](research.md) R4.
