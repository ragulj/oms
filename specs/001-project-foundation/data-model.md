# Data Model: Project Foundation

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-05

## Domain entities: none

This feature defines no domain entities. `Order` and `OrderLineItem` are deferred to later
specifications by explicit instruction, and no table holding business data is created here.

The plan's source layout has no `models/` directory for the same reason. An empty one would
invite someone to fill it before the domain spec exists.

Everything below is foundation scaffolding: configuration, the migration ledger, the health
report, and the scheduled task registration.

---

## Configuration Set

The complete set of settings the service recognises (FR-005 through FR-009). Every one is read
from the environment, validated at startup before traffic or scheduled work begins (FR-006),
and rejected with a message naming the offending setting when missing or malformed (FR-007).

The **Source** column matters. It separates values the specification actually fixes from
values proposed here that the spec does not yet constrain. Treat the second group as a proposal
open to challenge, not as settled requirement.

| Setting | Shape | Required | Default | Source |
|---------|-------|----------|---------|--------|
| Database file location | Filesystem path | Yes | none | FR-015 refers to a configured database location |
| Scheduled task interval | Duration | No | **5 minutes** | FR-029, fixed by clarification |
| Shutdown drain timeout | Duration | No | **10 seconds** | FR-033, fixed by clarification |
| Log verbosity | Enumerated level | No | `info` | FR-031 requires configurable verbosity; the default level is proposed here |
| HTTP listen port | Integer, 1 to 65535 | No | `3000` | Proposed. The spec requires a running service but never names a port |

### Validation rules

- Every setting is validated before the service accepts traffic or registers scheduled work
  (FR-006). Validation is not lazy, and no setting is read for the first time at its point of
  use.
- A failure exits non-zero and names both the setting and the expected shape (FR-007). The
  budget is 5 seconds from launch (SC-004).
- Durations must reject zero and negative values. A zero drain timeout would make FR-032's
  drain unobservable, and a zero interval would spin the scheduler.
- The committed example file enumerates every setting above with safe placeholders and carries
  no real secrets (FR-008). Real settings files stay out of version control (FR-009).
- Secrets are redacted from all output, including the startup record (FR-031).

### Relationships

The Configuration Set has no persistence. It is resolved once at startup and is an input to
the database connection, the scheduler registration, the logger, and the shutdown handler.
Changing a value requires a restart, which User Story 6's third acceptance scenario assumes.

---

## Migration Ledger

The record of which versioned migrations have been applied (FR-012), used to decide what
remains pending.

| Attribute | Purpose |
|-----------|---------|
| Migration identity | Which committed migration file the row corresponds to |
| Applied-at marker | Ordering, so "pending" means everything after the last applied entry |

**This table is created and maintained by the migration tool, not by application code.** Its
exact columns are the tool's business. It is listed here because two requirements read it
rather than write it: FR-011's repeatable apply command, which must produce no changes when
current, and FR-015's startup check.

### Lifecycle rules

- Written only by the documented migration command (FR-011).
- **Never written during startup** (FR-015). The service reads this ledger, compares it to the
  committed migration files, and refuses to boot when anything is pending, naming what.
- The test harness applies migrations explicitly to its throwaway database before the first
  test (FR-018), rather than relying on any boot-time side effect.

---

## Health Report

The observable summary returned by the health check (FR-030). Not persisted; computed per
request. The wire format is specified in [contracts/health.md](./contracts/health.md).

| Attribute | Purpose |
|-----------|---------|
| Overall status | Healthy only when the service and every dependency are healthy |
| Dependency name | Which dependency a failure belongs to |
| Dependency status | Per-dependency result, currently the database only |

### Rules

- Success is reported only when the service and its database are both healthy (FR-030).
- A failure names the failing dependency. It does not report healthy with a detail field
  buried in the body, which was considered and rejected during clarification because probes
  key off the status rather than the body.
- There is no separate liveness report. The declared scope has no orchestrator to consume one.

---

## Scheduled Task Registration

The placeholder recurring task (FR-026 through FR-029). Held in memory, not persisted.

| Attribute | Purpose |
|-----------|---------|
| Task identity | Names the registration so an overlap guard can address it |
| Interval | Duration between executions, from configuration, default 5 minutes |
| In-flight flag | Whether an execution is currently running |
| Shutdown flag | Whether shutdown has begun, blocking new executions |

### Rules

- An execution must not begin while the previous one is still running (FR-028). The scheduling
  library does not enforce this by itself, so the in-flight flag is application state that has
  to exist rather than a configuration option.
- No new execution starts once shutdown has begun (FR-034).
- The task carries no business behaviour and emits observable evidence only (FR-027).
- It is expected to be replaced rather than extended when real scheduled work arrives.

---

## Service lifecycle states

The one genuine state machine in this feature. Constitution Principle I governs *order* status
and does not apply here, but the ordering below is what makes FR-006, FR-015, and FR-032
testable as distinct failures rather than one undifferentiated boot error.

| From | To | Trigger | On failure |
|------|-----|---------|------------|
| Starting | Config validated | All settings parse and validate | Exit non-zero naming the setting (FR-007) |
| Config validated | Database reachable | Connection opens, pragmas applied (FR-013) | Exit non-zero, location unreachable or unwritable (FR-015) |
| Database reachable | Migrations current | Ledger matches committed migrations | Exit non-zero naming pending migrations (FR-015) |
| Migrations current | Ready | Routes served, scheduled work registered | n/a |
| Ready | Draining | Termination signal received | n/a |
| Draining | Stopped | In-flight work finished, database closed | Force exit non-zero naming abandoned work (FR-033) |

Each downward transition is a distinct, separately testable failure. That is the point of
ordering them: a single "failed to start" error would satisfy none of these requirements
individually.
