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

## Three checks that cannot be automated from inside the suite

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

### 3. Source-loader boot on Linux (Spec 006 FR-021, SC-010)

The suite runs under ts-jest, which transforms sources with its own compiler. It does **not** exercise
the `-r ts-node/register` loader that `start:dev`, `db:migrate`, `db:seed`, and `openapi:export/check`
use, so the suite passing on Linux proves the code assembles there, not that the loader boots. One
automated gate does exercise the loader: `npm run openapi:check` runs through `ts-node/register` and is
part of `npm run check`. The full HTTP boot is verified manually on the target platform:

```bash
rm -rf ./data && npm run start:dev
```

Expected: `service.started` in the log, with `./data` created on the way, and a running service on the
configured port.

**Last verified on Linux: 2026-09-05, Node 24.20.0.** `start:dev` reached `service.started` with the
data directory created on the way and the required pragmas applied (`journal_mode=WAL`,
`foreign_keys=ON`, `busy_timeout=5000`), served a POST and GET order round-trip, and shut down cleanly
on SIGTERM (`shutdown.complete`). The other three loader entry points were verified in the same run:
`openapi:check`, `db:migrate` into a two-level-deep missing directory, and `db:seed` all exited 0.

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

## The HTTP harness binds its server once (Spec 006)

`createLifecycleHarness` in `test/support/http-fixtures.ts` binds the Nest HTTP server with
`listen(0)` before returning. Nest's `app.init()` alone does not bind, and supertest then binds
lazily per request and closes the socket again when that request ends. Sequential tests never
notice. A test issuing concurrent requests does: each call observes an unbound server, they race to
bind it, and the losers fail with `ECONNRESET`.

This was a latent defect, not a platform one — it reproduced deterministically (5 of 5 runs), and
outside Jest entirely, against a plain `http.Server` on both Node 22 and Node 24. It surfaced during
Spec 006 only because that was the first run of the suite on Linux, where
`http-contract.spec.ts`'s five-concurrent-request correlation test could finally execute. The fix
ships with Spec 006 as supporting work required by FR-016 (the full suite must pass); it changes no
test's expectation, so it does not trip FR-016's rule that a changed expectation signals an
unintended behaviour change.

Add concurrent-request tests freely: the server stays bound for the lifetime of the harness.

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

### Spec 004: documentation, where a green suite is the easy failure

A documentation feature can look finished while being wrong, and its tests can look thorough while
asserting nothing. Spec 004's sweep mutates `src/docs/`, the two controllers, the configuration
schema, the seed, and the committed `openapi.json`.

**17 of 17 mutations turned the suite red.**

| Mutation | Guarantee it removes |
| :--- | :--- |
| `global-500` | no operation carries an unprovokable server error (FR-038) |
| `security-scheme` | no credential input is rendered (FR-047, FR-048) |
| `server-list` | the page executes against its own origin only (FR-055) |
| `use-global-prefix` | the documentation paths sit outside the version prefix (FR-060a) |
| `no-strict-request` | request schemas publish that unknown properties are rejected (FR-015) |
| `hand-written-limit` | the documented page-size bounds are the enforced ones (FR-010, FR-018) |
| `decimal-money-example` | no monetary example is a decimal (FR-023, Principle IV) |
| `date-time-format` | no timestamp is rendered as a formatted date (FR-024, Principle V) |
| `cursor-encoding-described` | the cursor is opaque and its encoding is not described (FR-027) |
| `drop-error-code` | each operation names every code it can emit (FR-034, SC-003) |
| `response-schema-drift` | the documented response shape is the real one (FR-009, FR-012) |
| `undocumented-route` | every routed operation appears in the document (FR-076, SC-001) |
| `location-header` | the `Location` header on creation is documented (FR-044) |
| `correlation-header` | the correlation header is documented on failures too (FR-043) |
| `coerce-boolean` | the string `false` switches documentation off (FR-059) |
| `seed-identifier-drift` | the prefilled examples name identifiers the seed creates (FR-053a) |
| `stale-export` | the committed export matches the served document (FR-067, FR-083) |

**What this run proves, and what it does not.** The sweep ran with `--bail`, which stops at the first
failing file, and it records only that file. `export-parity.spec.ts` was the recorded catcher for 11
of the 17, because it runs early and compares the whole document to the committed export, so **any**
change to the document trips it.

That is enough for SC-011 as written: removing any guarantee turns the suite red, and none of the
seventeen slipped through. It is *not* evidence that each targeted assertion is individually
load-bearing. `conventions.spec.ts` may or may not be what catches a decimal money example; this run
cannot say, because export-parity got there first. Establishing that needs a re-run with
export-parity excluded, so each mutation has to be caught by the suite written for it. That re-run has
not been done, and this paragraph exists so nobody reads the table above as saying otherwise.

Three mutations are worth naming.

`coerce-boolean` and `global-500` are the two traps in this feature that **report success while being
wrong**. `z.coerce.boolean()` turns the string `'false'` into `true`, so the setting reads as honoured
while the page is served; `DocumentBuilder.addGlobalResponse` reads as "one response at document
level" and in fact copies it into every operation. Neither produces an error, a warning, or a log
line. Both are in the sweep because a comment saying "do not do this" is not a check.

`response-schema-drift` removes one property from the response schema and is caught because every
integration test parses its real response through that schema. It is the mutation that justifies the
one place this feature accepts describing something twice.

### What the sweep did not catch, and the quickstart did

Spec 004's suite went green, all 17 mutations went red, and the published document was still wrong.

`ErrorBody.details` was described as carrying "per-field problems on a validation failure, and an
empty array otherwise". Five codes carry detail, not one: `VALIDATION_FAILED`, `CUSTOMER_NOT_FOUND`,
`PRODUCT_NOT_FOUND`, `INVALID_CURSOR` and `INVALID_IDEMPOTENCY_KEY`, two of which name a header or a
query parameter rather than a body field. Four published examples showed `details: []` for responses
that in reality carry an entry.

Nothing in the suite could see it. `response-conformance.spec.ts` parsed real bodies through the
schema, and the schema was right — `details` is an array either way, so a wrong *description* passes a
structural check. Worse, `failure-documentation.spec.ts` asserted the description matched
`/empty array otherwise/i`, so the test did not merely miss the defect, it **pinned it in place**. A
mutation sweep cannot find this either: removing a false claim does not turn a suite red.

Walking `quickstart.md` against a running service found it in one command, by reading a response
instead of asserting about one.

Both have been corrected, and the replacement assertions were verified by re-introducing the defect
and confirming two suites turn red. The general assertion now provokes all eight caller-reachable
codes and compares each one's detail list against what the published description promises for it, so
the document and the service cannot disagree here again.

The lesson worth keeping: a test that asserts a document contains a *phrase* proves only that
somebody wrote that phrase. Assert against the behaviour the phrase describes.

### Spec 005: a defect no outcome could see

Spec 005 removed one wasted claim per tick. Its sweep mutates `src/scheduler/order-promotion.task.ts`.

**3 of 3 mutations turned the suite red**, and unlike Spec 004's sweep each was caught by a different
suite, and by the suite actually written for it:

| Mutation | Guarantee it removes | Caught by |
| :--- | :--- | :--- |
| `short-claim-exit` | a short claim ends the tick (FR-004) — the feature itself | `promotion.claim.spec.ts` |
| `iteration-cap` | the cap bounds the tick (FR-008, FR-010, Principle III) | `promotion.bounded.spec.ts` |
| `stop-reason-guard` | the guard is distinguishable from a drain in one record (FR-023) | `promotion.termination.spec.ts` |

`iteration-cap` replaces `while (iterations < maxIterations)` with `while (true)`. It is the mutation
worth keeping, because it is the exact edit a careless reading of the requirement invites: the
specification asks for the cap to stop being the loop's condition, and doing that literally produces
an unbounded claim loop on a synchronous driver, holding the single write lock for as long as it runs.
The cap deliberately stays in the `while` and the short-claim exit fires first, so boundedness is a
property of the loop's shape rather than of a `break` a later edit could move.

**The promoted count cannot see this defect.** Before and after the fix, the same orders are promoted,
in the same order, leaving the same rows behind. The only observable that moves is the number of
claims performed, which is why `promotion.termination.spec.ts` asserts `iterations` directly in every
case and states in a comment that a promotion-count assertion would pass identically against the
defect and against the fix.

That is the same lesson Spec 004 learned from the other direction, where a test asserted that a
document contained a sentence rather than that the service behaved the way the sentence claimed. Both
are the same mistake: asserting on something adjacent to the guarantee instead of on the guarantee.

### Spec 006: two startup-path guarantees

Spec 006 made a clean Linux checkout runnable — a loader-scoped `ts-node` block so sources resolve on
Linux, and `createConnection` creating the missing (gitignored) data directory instead of rejecting it.
Its sweep was planned with two mutations, one per fix. **One of them turned out to have nothing behind
it, and this record says so rather than rounding up.**

**1 of 2 mutations turns the suite red.**

| Mutation | Guarantee it removes | Caught by |
| :--- | :--- | :--- |
| `no-mkdir` | `createConnection` creates the missing data directory (FR-006) | `connection.directory.spec.ts` |
| `no-ts-node-block` | *(withdrawn — see below)* | **nothing** |

`no-mkdir` is behavioural, not a compile error. Removing the `mkdirSync` *call* (not its import) would
leave the suite green wherever the directory already exists, so `connection.directory.spec.ts` points at
a throwaway directory that does not exist and fails with "directory does not exist" when the create is
gone — verified red during implementation, then restored.

`no-ts-node-block` was **withdrawn on 2026-09-05** after being run on Linux for the first time. It does
not turn anything red. Earlier revisions of this file claimed it failed the boot and `npm run
openapi:check` on Linux; that claim was written before the mutation had been executed there, and it is
false. With the dependency installation intact, removing the `ts-node` block leaves `openapi:check` at
exit 0 and `start:dev` reaching `service.started` on **both** Node 22.22.2 and Node 24.20.0.

The reason is that the failure Spec 006 attributed to the loader was a corrupt `drizzle-orm` install
missing 336 of its 444 `.d.ts` files — which is also why it broke `tsc` and ts-jest, two toolchains the
loader configuration never touches. The block is retained as hardening against `exports`-only
dependencies (spec FR-003) and is knowingly **not** backed by a mutation. Spec FR-023 and SC-010 were
amended to withdraw the claim; `research.md` R1 carries the full diagnosis.

### Spec 006 Phase 8 — the Windows teardown failure that did not reproduce (FR-024–FR-026, SC-006)

SC-006 promises the suite passes on Linux **and** on the previously supported environment. Only Linux
was ever verified, and a Windows-only `EPERM` deleting the shared test database was reported after the
feature closed. Phase 8 was written to diagnose it, under FR-025's rule that a remedy must be re-derived
from evidence when the reported mechanism and the code disagree.

**The reported failure does not reproduce.** On Windows 11, Node v24.19.0, npm 11.17.0, at `db8ee43`:
three consecutive `npm test` runs gave **65/65 suites, 468/468 tests, exit 0**, no `globalTeardown`
failure, and an empty `%TEMP%\oms-test\` afterwards — `removeTestDatabase` removed the database and both
its `-wal` and `-shm` siblings every time.

Two corrections the next reader should inherit:

- The suite's database is **not** in `data/`. It is `join(tmpdir(), 'oms-test', 'oms-test.db')`
  (`test/setup/database.ts:11-12`); `data/` holds only the development database. The Phase 8 task list
  originally pointed the diagnosis at `data/oms-test.db`, which would have started it in the wrong
  directory.
- The likeliest reason the failure is gone is `51df411`, which made the HTTP harness bind its server
  once for its lifetime instead of letting supertest bind lazily per request and close it again —
  per-request bind-and-close is the shape that strands handles on Windows. That commit was motivated by
  a Linux `ECONNRESET` race, so if it also fixed this, it did so as an unrecorded side effect. **This is
  a hypothesis.** Confirming it needs a bisect to `93735c6`, which has not been run.

The FR-024 hygiene changes went in regardless, because they stand on their own merit rather than as the
remedy for this failure: the degraded application in `response-conformance.spec.ts` now releases through
`degraded.close()`, and the one deliberate bypass in `shutdown.drain.spec.ts` now carries the comment
FR-024's exemption requires. FR-026 was re-checked and holds — `removeTestDatabase` still issues a single
`rmSync(path, { force: true })` per file, with no retry, backoff, or force-delete added to paper over a
lock.

**SC-006 is therefore not closed here.** The suite is green on both environments, but FR-025's acceptance
rests on naming the retained resource, and no resource was named because nothing was retained. That
disposition is recorded as owed in the task list rather than resolved by assertion.

**A separate defect surfaced in the same run**: `npm run check` does not exit 0 on a Windows checkout.
`prettier --check .` fails on 45 working-tree files whose line endings are CRLF — `git ls-files --eol`
reports the index as `lf` throughout against a worktree of 45 `crlf`, 177 `lf` and 1 `mixed`, with
`core.autocrlf=true` and no `.gitattributes`. Because `npm run check` chains with `&&`, eslint,
`tsc --noEmit` and `openapi:check` never run. This is unrelated to Phase 8's edits, both of which pass
prettier, but it means the check gate has only ever been proven on Linux.

### Suite runtime (SC-012)

Results are identical across consecutive runs: 63 suites, 443 tests, all passing, every time.

The runtime increment this feature adds could **not** be measured reliably on this machine. Five runs
of the identical full suite reported 176.9 s, 73.7 s, 22.3 s, 71.6 s and 21.8 s — an eightfold spread
on unchanged content, dominated by ts-jest transform-cache state and background load rather than by
the tests. A paired alternating measurement made that plain:

| Pass | Full (63 suites, 443 tests) | Without docs (48 suites, 292 tests) | Apparent increment |
| :--- | ---: | ---: | ---: |
| 1 | 71.6 s | 89.0 s | **−17.4 s** |
| 2 | 21.8 s | 15.3 s | +6.5 s |

Pass 1 reports the smaller suite as slower, which is impossible and is the measurement disqualifying
itself. The honest statement is that the increment is smaller than this environment's run-to-run
variance. Pass 2, the least-loaded pair, puts it at roughly 6 s for 15 suites and 151 tests, and a
warm full run at about 22 s, comfortably inside the two-minute advisory budget. Treat the 6 s as an
order of magnitude, not a measurement.

Spec 003 recorded a 5.96 s suite on a quiet machine. If a precise figure is ever needed, measure with
the transform cache warmed and nothing else running, and take a median of five rather than one
sample.

**Do not commit while a sweep is running.** It mutates files in place and restores them at the end,
so a commit taken mid-sweep captures a mutated file. That happened once here: commit `d046448`
captured the `expected-status` mutation and `5706e5c` restores it. Let the sweep finish before
touching git.
