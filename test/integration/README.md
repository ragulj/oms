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
