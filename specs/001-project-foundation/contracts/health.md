# Contract: Health Check

**Feature**: [spec.md](./spec.md) | **Requirements**: FR-030, FR-035 | **Date**: 2026-09-05

This is the only external interface spec 001 exposes. Everything else in the foundation is
internal, so `contracts/` contains exactly one document.

## Routing convention

Settled during clarification on 2026-09-05, and binding on every later specification.

| Route class | Location | Reason |
|-------------|----------|--------|
| Health check | Stable, **unversioned** path | Supervisors and uptime probes must not have to track the API version |
| Domain routes | Under a **versioned prefix** | A breaking change can then ship beside the version it replaces instead of breaking existing callers |

Spec 001 introduces no domain route. The versioned prefix is declared here so the first spec
that adds one inherits the convention rather than inventing it.

**Proposed concrete paths**: `/health` for the check, `/api/v1/...` for future domain routes.
The spec fixes the *shape* of this convention, not these exact strings, so treat the literals
as a proposal open to challenge and the versioned-versus-unversioned split as settled.

## Endpoint

```
GET /health
```

Unauthenticated, per the spec's assumption that the declared scope is local development and
automated testing only.

## Semantics

Success is reported **only** when the service and every dependency are healthy. Today the
dependency list is the database alone.

| Condition | Status | Meaning |
|-----------|--------|---------|
| Service running, database reachable | Success (`200`) | Fully healthy |
| Service running, database unreachable | Failure (`503`) | Body names the failing dependency |

The status codes are a proposal. What the spec fixes is that a dependency failure produces a
**failure status**, not a success carrying a detail field. That option was explicitly
considered and rejected during clarification, because probes key off the status code and would
otherwise report a database outage as healthy.

There is no separate liveness endpoint. A liveness and readiness split exists to let an
orchestrator distinguish "restart this process" from "stop routing to it", and the declared
scope has no orchestrator.

## Response shape

Success:

```json
{
  "status": "healthy",
  "dependencies": { "database": "healthy" }
}
```

Failure:

```json
{
  "status": "unhealthy",
  "dependencies": { "database": "unhealthy" }
}
```

The dependency map is a map rather than a flat field so that adding a second dependency later
does not change the shape of the response. The failing dependency must be identifiable from
the body (FR-030); the exact key naming is open.

## Behaviour under startup and shutdown

- **Before Ready**: the endpoint does not answer. Configuration failure, an unreachable
  database, and pending migrations all cause the process to exit before it serves anything
  (FR-007, FR-015). A caller sees a refused connection, not an unhealthy response.
- **After startup**: FR-015 governs the startup case only. A database lost *after* a successful
  boot is exactly the case this contract's failure response exists for, which is why the spec
  carries both a startup check and a runtime health check without contradiction.
- **During drain**: not specified. The spec has no load balancer to withhold traffic from, so
  reporting unhealthy while draining would serve no consumer. Raised and deliberately left
  open rather than decided by default.

## Acceptance coverage

| Scenario | Source |
|----------|--------|
| Running service reports healthy | User Story 1, scenario 1 |
| Response reports overall status and database reachability | User Story 1, scenario 2 |
| Database unreachable after startup returns failure naming the database | User Story 1, scenario 4 |
