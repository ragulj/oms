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
