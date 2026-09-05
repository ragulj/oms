# Contract: Startup (source loader + runtime data directory)

This feature has no HTTP or API surface. Its observable contract is the **startup outcome** under two
inputs: how sources are loaded, and the state of the data directory. Both are stated here as
input → outcome so tests and the quickstart assert against a fixed reference.

## 1. Source loader contract

**Command shape**: `node -r ts-node/register <entry>.ts` (as used by `start:dev`, `db:migrate`,
`db:seed`, `openapi:export`, `openapi:check`).

| Input | Required outcome |
| :--- | :--- |
| Any of the four loader entry points, on Linux, after the `ts-node` block is added | Loads and runs to its normal completion (server serves / script finishes). Does not exit during source loading |
| Same, on the environment already in use | Unchanged from today |
| `npm run build` (`tsc -p tsconfig.build.json`), any OS | Compiled output unchanged by the block |
| `tsc --noEmit` (inside `npm run check`), any OS | Unaffected by the block |

**Failure distinction**: a genuine module-not-found for a specific dependency, or a genuine type error,
MUST still surface as itself — the block removes the blanket source-loading failure, it does not suppress
real errors (spec FR-005).

## 2. Runtime data directory contract

**Function**: `createConnection(databasePath: string): Connection` in `src/database/client.ts`.

| Input (`databasePath`) | Directory state before | Required outcome |
| :--- | :--- | :--- |
| A file path, e.g. `./data/oms.db` | Containing directory **absent** | Directory (and any missing parents) is created; database opens; pragmas applied; connection returned (FR-006) |
| A file path | Containing directory **present** | Database opens; pre-existing directory and its contents untouched (FR-007) |
| A file path | Directory cannot be created (permission denied, or a non-directory file at the path) | Throws `DatabaseUnavailableError` naming the directory cause; no connection returned (FR-009) |
| A file path | Directory present but the file/directory is not writable | Fails as today with `DatabaseUnavailableError` (FR-010) |
| `:memory:` | — | No directory created; in-memory database opens as today (FR-008) |
| A bare filename, e.g. `oms.db` | `dirname` is `.` (always present) | Create is a successful no-op; database opens |

**Preserved connection guarantees** (unchanged by this feature): every returned connection has
`journal_mode = WAL`, `foreign_keys = ON`, and a non-zero `busy_timeout` applied by `applyPragmas`
(Constitution scope; spec FR-010). `close()` remains idempotent.

**Startup mapping** (unchanged): `main.ts` catches `DatabaseUnavailableError` and exits with
`startup.database_unavailable`. This feature changes which conditions reach that catch (a missing directory
no longer does; an uncreatable directory does), not the outcome shape.

## 3. What must not change

- No new configuration setting; `DATABASE_PATH` semantics unchanged, still working-directory-relative.
- No schema, migration, or dependency change.
- No domain endpoint, response, or behaviour change — this contract is entirely pre-request.
