# Implementation Plan: API Documentation and Swagger Playground

**Branch**: `004-api-documentation` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-api-documentation/spec.md`

## Summary

Publish the HTTP surface that Specs 001 and 003 already built, as an OpenAPI document served at
`/docs-json`, an interactive page at `/docs`, and a committed export that the repository's
verification command compares against. No endpoint, field, status code or stored value changes.

The whole design question is how to describe the API without creating a second description that can
drift from the first. Phase 0 answered it in three parts, each measured rather than assumed:

**Requests describe themselves.** zod 4 converts the live `createOrderSchema` and `listOrdersSchema`
straight to OpenAPI schema objects, carrying every bound with them. `maxItems: 100` and
`maximum: 1000000` arrive from the constants the service enforces, and `additionalProperties: false`
arrives because Spec 003 used a strict object, so FR-015's claim that unknown properties are rejected
is derived rather than asserted. Nothing about a request is retyped.

**Responses cannot describe themselves, so they are described by something executable.** `OrderView`
and its siblings are TypeScript interfaces, erased at runtime. They are given strict zod schemas that
serve two purposes at once: they generate the documented components, and every integration test parses
its real response through them. A response that gains an undocumented field fails, and a documented
field the response lacks fails too. This is the one place the feature accepts a second description of
a shape, and it is accepted only because the second description is run against the first.

**The library's most inviting feature does the opposite of what was clarified.**
`DocumentBuilder.addGlobalResponse` reads as the direct implementation of FR-038 and in fact injects
the response into every operation, which is exactly what the clarification ruled out and what would
force SC-003 to carry an exemption. It is not used, and a test asserts no operation carries a 500.

## Technical Context

**Language/Version**: TypeScript 5.9.3 on Node.js 22 or newer, unchanged. Verified here on 24.19.0.

**Primary Dependencies**: one new runtime dependency, `@nestjs/swagger@12.0.1`, peering correctly on
the installed NestJS 12 and bringing `swagger-ui-dist@5.32.14` with it. Its `class-validator` and
`class-transformer` peers are marked optional and are **not** installed, preserving the position Spec
003 took. zod 4.5.4 does the schema conversion and needs nothing added. This breaks Spec 003's
zero-new-dependency record, which is inherent to the feature rather than a shortcut: the alternative
is hand-writing a document, which FR-013 forbids.

**Storage**: none. This feature adds no table, no column, no index and no migration, and the
documentation layer performs no read or write against the database.

**Testing**: Jest 30 with ts-jest through the existing `createTestApp` harness, exercising the real
application graph. Documentation tests fall into three kinds: assertions against the generated
document, assertions against live responses provoked through `supertest`, and one assertion comparing
the served document to the committed export.

**Target Platform**: unchanged. Documentation is served by the same process, on the same port and
origin, so no cross-origin configuration exists or is introduced.

**Project Type**: web service. This feature contributes a documentation layer and an export script.

**Performance Goals**: none stated for serving. The one measurable cost is that the verification
command now builds the document, which is in-process generation and not a server start. Phase 0
measured generation as deterministic and fast enough to be unremarkable.

**Constraints**: the document must not misrepresent the two conventions the constitution protects.
Money is an integer count of minor units and must never be typed, formatted or exemplified as a
decimal. Ordering timestamps are integer microseconds and must never appear as a formatted date. The
cursor is opaque and its encoding must not be described. These are enforced by a document walk rather
than by review.

**Scale/Scope**: five documented operations across two controllers, roughly eight shared schema
components, three documentation routes, one configuration setting, one export script, one committed
artifact.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.1.0**.

| Principle | Verdict | Basis |
| :--- | :--- | :--- |
| I. Centralized State Machine | **PASS** | No transition logic is added anywhere. FR-005 goes further and forbids the document from describing an operation that sets an arbitrary status, which is the only way a documentation feature could undermine this principle: by advertising a door that does not exist and inviting someone to build it |
| II. Lock-Free Atomic Transitions | **PASS** | No status write is added. FR-070 forbids altering error handling, so the mapping of a zero changed-row count to 409 is untouched, and FR-039 requires the document to describe that 409 honestly as covering both a late caller and an always-illegal transition |
| III. Bounded Background Processing | **PASS** | FR-074 forbids any change to the background job, its cadence or its bounds. The job has no HTTP surface and appears nowhere in the document |
| IV. Exact-Integer Money and Immutable History | **PASS** | FR-023 requires every monetary field to be documented as an integer of minor units and forbids a decimal type, format or example. FR-078 and SC-004 make that machine-checkable by the document walk R11 measured. FR-005 and FR-071 keep the document free of any update or delete operation, so it cannot advertise a path that would rewrite financial history |
| V. Two-Phase Keyset Reads | **PASS** | FR-024 forbids documenting any timestamp as a formatted or millisecond value, and FR-027 forbids describing the cursor's encoding or giving a decodable example. Both close the same hole from the documentation side that Spec 003 closed from the response side: a consumer who is handed a truncating rendering will build a cursor out of it |
| VI. Integration-Proven Verification | **PASS** | FR-084 runs every test against the real assembled application, since the property under test is what the assembled service publishes. FR-085 keeps the existing isolation rules. FR-086 requires that removing any documentation guarantee turns the suite red. No new table means no change to the three-phase cleanup ordering |
| Scope: single currency | **PASS** | No currency field or code is documented, because none exists |
| Scope: Drizzle as sole persistence path | **PASS** | FR-073 states it directly: the documentation layer neither reads nor writes the database. The document is generated from the application's routing metadata and from schemas, not from data |
| Workflow: build fails on zero tests | **PASS** | `passWithNoTests: false` unchanged |

**Gate result: PASS, with no recorded deviation.** The Complexity Tracking section below is empty and
says so.

Three things are worth stating rather than leaving a reviewer to reconstruct:

**The new dependency is not a deviation.** The constitution constrains the persistence path, the money
path, the ordering path and the verification method. It says nothing about the dependency count, and
`@nestjs/swagger` touches none of those paths. Spec 003's zero-new-dependency result was a property of
that feature, not a rule this one inherits.

**Response schemas are a second description, and that is deliberate.** FR-008 forbids a second,
independently maintained description of a request body. The response schemas introduced under R10 are
a second description of a response shape, which sits close to that line. They are permitted because
they are not independently maintained: every integration test parses its real response through them,
so the schema and the implementation cannot disagree without a test failing. A description that is
executed against the thing it describes is a check, not a copy.

**This feature adds an obligation to Spec 003's seed command.** FR-053a requires the seeding command
to produce documented, stable identifiers so the page's prefilled examples resolve on first execution.
That is a new guarantee attached to an artifact another specification owns. It changes no behaviour of
that command, only pins what it already does and asserts it, and it is recorded here so the coupling
is visible rather than discovered later.

Re-evaluated after Phase 1 design: unchanged. The design added no table, no persistence access and no
domain logic, and the two controllers gain metadata decorators that carry no runtime behaviour.

## Project Structure

### Documentation (this feature)

```text
specs/004-api-documentation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── openapi-document.md   # Phase 1 output: what the published document must contain
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/
├── docs/
│   ├── openapi.schemas.ts        # zod registry: request and response shapes with component ids
│   ├── openapi.examples.ts       # prefilled examples, pinned to the seeded identifiers
│   ├── openapi.document.ts       # builds the document: builder config + component injection
│   ├── order-api.decorators.ts   # one composed decorator per order operation
│   └── health-api.decorators.ts  # one composed decorator for the health check
├── orders/orders.controller.ts   # + one decorator per route, no behaviour change
├── health/health.controller.ts   # + one decorator, no behaviour change
├── config/config.schema.ts       # + DOCS_ENABLED, read with z.stringbool (R13)
└── main.ts                       # + conditional mount at /docs, + startup log line

scripts/
└── export-openapi.ts             # writes openapi.json without listening; also the check mode

openapi.json                      # the committed export (FR-065)

test/integration/docs/            # this feature's suites
```

**Structure Decision**: a `src/docs/` folder alongside the existing concern folders, matching how the
repository already groups (`config/`, `database/`, `health/`, `http/`, `logging/`, `orders/`,
`scheduler/`).

The controllers gain **one composed decorator each per route** rather than a stack of ten. Every
documentation decorator for an operation is assembled in `src/docs/` with `applyDecorators` and
applied as a single name, so `orders.controller.ts` stays readable as a controller and the
documentation content stays in one place where the mutation sweep can reach it. The alternative,
building the `paths` object by hand after `createDocument`, was rejected because it decouples the
description from the route it describes, which is the drift this feature exists to prevent.

`openapi.json` lives at the repository root rather than under `specs/`, because it is a build output
consumed by tooling, not a specification artifact.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations. This section is intentionally empty.

Spec 002 recorded one deviation, that trigger DDL cannot live in a Drizzle schema module. Spec 003
recorded none. This feature records none: it adds no persistence, no money arithmetic, no ordering
column and no transition, so the principles that are hard to satisfy are the ones it does not touch.
The principles it does touch, IV and V, it satisfies by refusing to publish a rendering that
contradicts them, and that refusal is asserted by the document walk rather than left to review.
