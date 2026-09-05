# Integration tests

Every test here runs against a real SQLite database, per Constitution Principle VI. There are
no mocked repositories, because a mock cannot observe a lost update, a coerced `REAL`, or a
truncated timestamp, which are the failure modes these tests exist to catch.

## How isolation works

- `global-setup.ts` deletes any leftover throwaway database, then applies all migrations to a
  fresh one. Deleting first handles an interrupted earlier run.
- `per-test.ts` returns every table to a known empty state in a `beforeEach`, in three ordered
  phases. SQLite has no `TRUNCATE`, and two tables refuse row deletion outright. See
  [Isolation works three ways](#isolation-works-three-ways-as-of-spec-003) below.
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

## Isolation works three ways as of Spec 003

Spec 002's immutability triggers refuse row deletion on `orders` and `order_line_items`, so
`DELETE FROM` cannot clear them. Constitution v2.1.0 restates Principle VI as the isolation
*property* rather than the `DELETE FROM` *mechanism*, and names rebuilding as the required
alternative where deletion is refused.

Spec 003 added `idempotency_records`, which holds a foreign key into `orders`. That turned the two
mechanisms into **three ordered phases**, and the order is not a style choice.

| Phase | Tables | Mechanism | Why it sits here |
| :--- | :--- | :--- | :--- |
| 1 | `idempotency_records` | `DELETE FROM` | Its rows reference orders, and the drop in phase 2 is refused while they exist |
| 2 | `order_line_items`, `orders` | drop and recreate | Row deletion is refused by trigger; child before parent on the way down |
| 3 | `harness_probe`, `products`, `customers` | `DELETE FROM` | Phase 2 released the foreign keys pointing into products and customers, so deletion now succeeds |

Two of the three use the constitution's default mechanism. Only the middle one needs the heavier
alternative, which is what Principle VI requires.

`rebuild.ts` reads the DDL back out of `sqlite_master` rather than keeping its own copy, because a
second copy of the schema in test code is a copy that drifts, and a rebuild that drifts would
quietly test a different shape than production runs.

**Getting phase 1 wrong is expensive and the error message does not say so.** `DROP TABLE orders`
is refused outright while any idempotency row references it, so putting the new table in the phase 3
list, which looks natural, fails *every test that touches an order* with a foreign key error raised
during a table drop. Nothing in that message points at cleanup ordering. Spec 003 research R6 has the
measurement. The three lists live in `src/database/schema/index.ts` with the reason for each
position attached, so the ordering is data rather than a comment someone can drift from.

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

### Spec 003: behaviour, not just schema

Spec 003's guarantees live in application code rather than in DDL, so its sweep mutates `src/` and the
idempotency migration instead of the schema alone.

**11 of 11 mutations turned the suite red.**

| Mutation | Guarantee it removes |
| :--- | :--- |
| `strict-schema` | request schemas reject unknown keys (FR-003) |
| `expected-status` | the conditional update names its expected source status (Principle II) |
| `classify-404` | a zero-row transition is told apart from a missing order (FR-069) |
| `claim-outer-status` | the claim re-asserts status outside its subquery (FR-090) |
| `chunk-limit` | the claim is bounded by a row limit (Principle III) |
| `iteration-cap` | a tick stops at its iteration cap (FR-084) |
| `oldest-first` | the backlog is claimed oldest first (FR-089) |
| `total-exactness` | a derived total that is not exactly representable fails loudly (FR-025) |
| `cursor-tiebreaker` | the cursor carries a unique tiebreaker (Principle V) |
| `cursor-validation` | a malformed cursor is rejected rather than treated as absent (FR-050) |
| `idempotency-unique` | duplicate creation is impossible rather than unlikely (FR-034) |

Two are worth naming. `claim-outer-status` looks redundant with the subquery's own predicate, and the
sweep is the evidence that it is not: it is what excludes an order cancelled between the subquery
choosing it and the update reaching it. `cursor-validation` replaces a rejection with a silent restart
at page one, which returns a plausible page rather than an error, and is the kind of defect a
happy-path test never sees.

**Do not commit while the sweep is running.** It mutates files in place and restores them at the end,
so a commit taken mid-sweep captures a mutated file. That happened once here: commit `d046448`
captured the `expected-status` mutation and `5706e5c` restores it. Let the sweep finish before
touching git.
