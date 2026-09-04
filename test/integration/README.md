# Integration tests

Every test here runs against a real SQLite database, per Constitution Principle VI. There are
no mocked repositories, because a mock cannot observe a lost update, a coerced `REAL`, or a
truncated timestamp, which are the failure modes these tests exist to catch.

## How isolation works

- `global-setup.ts` deletes any leftover throwaway database, then applies all migrations to a
  fresh one. Deleting first handles an interrupted earlier run.
- `per-test.ts` clears every table in a `beforeEach` using `DELETE FROM`. SQLite has no
  `TRUNCATE`.
- `global-teardown.ts` removes the database and its `-wal` and `-shm` siblings.
- Test files run **serially** (`maxWorkers: 1`). SQLite admits one writer, so parallel workers
  sharing a database would surface lock contention as intermittent failures indistinguishable
  from real defects.

## Two checks that cannot be automated from inside the suite

Both are documented here rather than faked, because a test that pretends to cover them would
be worse than an honest gap.

### 1. A zero-test run must fail (FR-019, SC-006)

A suite cannot assert that it itself ran zero tests. Verify from the shell:

```bash
npm test -- --testPathPatterns 'no-such-test-file'
```

Expected: a non-zero exit status. This is enforced by `passWithNoTests: false` in
`jest.config.ts`. **Last verified: exit code 1.**

If this ever starts passing, every other test result in the repository becomes untrustworthy,
because a misconfigured runner matching nothing would report success.

### 2. Signal-driven shutdown (FR-032, SC-010)

`shutdown.drain.spec.ts` and `shutdown.timeout.spec.ts` cover the drain logic directly, which
is why `drain()` lives in `src/lifecycle/shutdown.ts` rather than inline in the signal handler.
What they do not cover is the signal delivery itself.

Windows does not deliver POSIX signals the way Linux does, so a test that spawns the service
and sends `SIGTERM` would be testing the platform rather than the code. Verify manually on the
target platform:

```bash
npm run build && node dist/main.js
```

Then send an interrupt. Expected: `shutdown.started` followed by `shutdown.complete` in the
log, and a zero exit status.

## Isolation works two ways as of Spec 002

Spec 002's immutability triggers refuse row deletion on `orders` and `order_line_items`, so
`DELETE FROM` cannot clear them. Constitution v2.1.0 restates Principle VI as the isolation
*property* rather than the `DELETE FROM` *mechanism*, and names rebuilding as the required
alternative where deletion is refused.

| Tables | Mechanism | Why |
| :--- | :--- | :--- |
| `harness_probe`, `customers`, `products` | `DELETE FROM` | Row deletion still works, and the constitution requires the default wherever it does |
| `orders`, `order_line_items` | drop and recreate | Row deletion is refused by trigger |

`rebuild.ts` reads the DDL back out of `sqlite_master` rather than keeping its own copy, because a
second copy of the schema in test code is a copy that drifts, and a rebuild that drifts would
quietly test a different shape than production runs.

The rebuild runs first in `beforeEach`. Dropping the order tables is what releases the foreign key
references into `customers` and `products`, so those can be cleared by deletion straight after.

**Granularity: per test, decided by measurement.** One rebuild costs 0.569 ms. Per test that is
about 66 ms across the run; per file it would be about 17 ms. The 49 ms difference is under one
percent of a 5.96 s suite, so the stronger isolation wins on its merits. See `research.md` R8.

## Mutation results (SC-010)

SC-010 requires that deleting any single guarantee from the schema turns the suite red. Verified by
mutating the committed migration SQL, running the suite, and restoring, one guarantee at a time.

**11 of 11 mutations correctly turned the suite red.** Both immutability triggers, both order
triggers, both monetary check clauses, the quantity floor, the status check, the generated line
total, and both order indexes.

The one worth naming is the monetary **range** clause. A test that pushes only an oversized plain
JavaScript number proves the `typeof` clause and never reaches the range clause, so deleting the
range clause would leave the suite green. The boundary tests pass a `BigInt` and a raw SQL literal
for exactly this reason, and the mutation confirms they are load-bearing rather than decorative.

Re-run the sweep after any schema change. A guarantee whose removal leaves the suite green is a
guarantee with no test behind it.
