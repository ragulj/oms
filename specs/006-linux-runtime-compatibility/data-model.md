# Data Model: Linux Runtime Compatibility

**There is no persistent data model change in this feature.** No table, column, index, trigger, view, or
migration is added, altered, or removed. `npx drizzle-kit generate` MUST report no pending change after
this work, which is the mechanical proof the statement above holds (plan Technical Context; spec FR-015,
SC-009).

This file exists to record the two non-persistent "entities" the feature reasons about, and to state
their invariants so the tasks and tests have a single reference.

## Entity: Runtime data directory

The directory that contains the service's single SQLite database file.

| Attribute | Value |
| :--- | :--- |
| Identity | `dirname(DATABASE_PATH)` — derived, never stored |
| Default location | `./data` (from the default `DATABASE_PATH=./data/oms.db`) |
| Resolution base | The process working directory. Relative paths resolve against it, unchanged (spec FR-013) |
| Version control | Excluded (`.gitignore` lists `data/`, `*.db`, `*.db-wal`, `*.db-shm`); absent on a fresh checkout |
| Lifecycle | Ensured at connection time by `createConnection`; created if absent (recursively), left untouched if present |
| Not applicable when | `DATABASE_PATH` is `:memory:` — no directory is created |

**Invariants**
- INV-1: After a successful `createConnection` for a non-`:memory:` path, the directory exists.
- INV-2: Ensuring the directory never modifies, moves, or deletes existing contents (idempotent create).
- INV-3: If the directory cannot be created, `createConnection` throws `DatabaseUnavailableError` naming
  the directory cause, and no partial connection is returned.
- INV-4: The database file itself is still created by the database engine, not by this feature.

## Entity: Source loader configuration

The configuration the direct-source-execution path (`node -r ts-node/register …`) reads to interpret and
resolve TypeScript modules at load time.

| Attribute | Value |
| :--- | :--- |
| Location | The `ts-node` top-level key in `tsconfig.json` |
| Fields | `compilerOptions.module = nodenext`, `compilerOptions.moduleResolution = nodenext` |
| Read by | ts-node (start:dev, migrate, seed, openapi export/check); Jest when loading `jest.config.ts` |
| Ignored by | `tsc` (build and `--noEmit`), ts-jest transform |

**Invariants**
- INV-5: The block changes module *resolution* at load time only; it does not change the compiled build
  output (`tsc` does not read the key).
- INV-6: The block does not alter the shared `compilerOptions` used by `tsc` and ts-jest.

## Relationship to configuration

No new configuration setting is introduced. `DATABASE_PATH` already exists (required, non-empty) and is
unchanged. This feature changes only what the service *does* when the path's directory is absent — it
ensures it rather than rejecting it — and how sources are *resolved* at load time.
