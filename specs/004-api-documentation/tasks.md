---

description: "Task list for API Documentation and Swagger Playground"
---

# Tasks: API Documentation and Swagger Playground

**Input**: Design documents from `/specs/004-api-documentation/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/openapi-document.md](contracts/openapi-document.md),
[quickstart.md](quickstart.md)

**Tests**: Included and mandatory. The specification devotes eleven requirements (FR-076 to FR-086) to
verification, and Constitution Principle VI requires that every claim be backed by an integration test
against the real assembled application. A documentation feature is unusually easy to fake, so the
tests are the deliverable as much as the document is.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves

## Path Conventions

Single project at the repository root: `src/`, `test/`, `scripts/`. Paths follow the structure
decision in [plan.md](plan.md).

---

## Phase 1: Setup

**Purpose**: The dependency, the setting, and somewhere to put the tests.

- [X] T001 Add `@nestjs/swagger@12.0.1` to `dependencies` in `package.json` and commit the resulting `package-lock.json`, confirming `class-validator` and `class-transformer` remain uninstalled (plan.md Technical Context)
- [X] T002 Add `DOCS_ENABLED` to `src/config/config.schema.ts` using `z.stringbool().default(true)`, never `z.coerce.boolean()`, with a comment recording the measurement in research R13
- [X] T003 [P] Add `DOCS_ENABLED=true` with its explanatory comment to `.env.example`, keeping the file's rule that it lists every setting the service recognises
- [X] T004 [P] Create the `test/integration/docs/` directory for this feature's suites
- [X] T005 [P] Add an `openapi:export` script to `package.json` that runs `scripts/export-openapi.ts`, and an `openapi:check` script that runs it in check mode

**Checkpoint**: The setting exists and is readable; nothing is served yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schemas, the document builder, and the mount. Every user story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Create `src/docs/openapi.schemas.ts` declaring a zod registry and registering `CreateOrderRequest` from the live `createOrderSchema` in `src/orders/order.schemas.ts`, so the request schema is derived and never retyped (FR-008)
- [X] T007 Extend `src/docs/openapi.schemas.ts` with the listing query schema derived from the live `listOrdersSchema`, converted with `io: 'input'` so `limit` stays optional (FR-018, research R2)
- [X] T008 Extend `src/docs/openapi.schemas.ts` with strict response schemas for `OrderView`, `OrderLineView`, `ListOrdersResponse`, `ErrorBody`, `ErrorDetail` and `HealthReport`, each registered with the component id named in `data-model.md` (FR-009, FR-022, research R10)
- [X] T009 Populate the `ErrorBody.code` enumeration from the exported `ERROR_CODES` tuple in `src/http/api-error.ts` rather than restating the codes, so a new code cannot be introduced without appearing (FR-011)
- [X] T010 Add a `toOpenApiSchema` helper in `src/docs/openapi.schemas.ts` that converts a registered schema with `target: 'draft-2020-12'` and strips the `$schema` key an OpenAPI schema object must not carry (research R1)
- [X] T011 [P] Create `src/docs/openapi.examples.ts` holding the prefilled request examples, naming the identifiers the seeding command creates, and the response examples whose line totals equal unit price times quantity and whose order totals equal the sum of their line totals (FR-030, FR-053)
- [X] T012 Create `src/docs/openapi.document.ts` building the document with `DocumentBuilder`, setting the OpenAPI version to `3.1.0`, the title, version and description, and the `Orders` and `Operations` tags (FR-007)
- [X] T013 Put the server-error statement, the integer-minor-unit statement, the integer-microsecond statement and the no-credentials statement into the document description in `src/docs/openapi.document.ts`, and deliberately do **not** call `addGlobalResponse`, with a comment recording that it injects the response into every operation (FR-038, FR-046, research R7)
- [X] T014 In `src/docs/openapi.document.ts`, inject the converted registry into `components.schemas` after `createDocument`, and assert no `securitySchemes` or `security` member is present (FR-047, research R8)
- [X] T015 Mount the document conditionally in `src/main.ts`: build and serve at `/docs` with `jsonDocumentUrl: 'docs-json'` only when `DOCS_ENABLED`, leaving `useGlobalPrefix` unset so the paths stay outside `/api/v1` (FR-049, FR-057, FR-059, research R3)
- [X] T016 Add the documentation address to the `service.started` log record in `src/main.ts` when documentation is enabled, so a developer never has to guess it (FR-061)
- [X] T017 Extend `test/setup/test-app.ts` with an option that mounts documentation on the test application exactly as `main.ts` does, so tests exercise the shipped arrangement rather than a parallel one (FR-084)

**Checkpoint**: A document is generated and served. Its content is still nearly empty.

---

## Phase 3: User Story 1 - Understand the API Without Reading the Source (Priority: P1) 🎯 MVP

**Goal**: A complete, accurate published contract covering every operation, its request, its
responses, its failures and its headers.

**Independent Test**: Start the service, open `/docs-json`, and confirm every routed operation appears
with its request shape, response shape and failure modes, and that nothing appears that is not routed.

### Tests for User Story 1

- [X] T018 [P] [US1] Write `test/integration/docs/route-coverage.spec.ts` asserting the document's operation set equals the router's, in both directions, excluding only the framework catch-all and the enumerated documentation routes (FR-076, SC-001, research R9)
- [X] T019 [P] [US1] Write `test/integration/docs/document-structure.spec.ts` asserting the OpenAPI version, the required `info` members, the two tags, that every `$ref` resolves to an existing component, and that no `securitySchemes` or `security` member exists (FR-068, FR-047, SC-008)
- [X] T020 [P] [US1] Write `test/integration/docs/failure-documentation.spec.ts` asserting every code in `ERROR_CODES` appears in the document, that each operation names only codes it can emit, and that **no operation carries a 500** (FR-034, FR-038, FR-080, SC-002)
- [X] T021 [P] [US1] Write `test/integration/docs/conventions.spec.ts` walking the whole document and asserting every field whose name ends `Minor` or `Us` is `type: integer`, that no node carries `format: date` or `format: date-time`, and that the documented examples are internally consistent (FR-023, FR-024, FR-030, FR-078, SC-004, research R11)
- [X] T022 [P] [US1] Write `test/integration/docs/request-schemas.spec.ts` asserting the documented bounds equal the constants the service enforces, and that every request schema carries `additionalProperties: false` (FR-010, FR-015, FR-016, FR-079)
- [X] T023 [P] [US1] Write `test/integration/docs/response-schemas.spec.ts` asserting the order representation is described once and referenced by every operation returning one, that derived values are marked read-only, and that the cursor is a plain opaque string with no described encoding (FR-022, FR-025, FR-027)

### Implementation for User Story 1

- [X] T024 [US1] Create `src/docs/order-api.decorators.ts` exporting one composed decorator per order operation via `applyDecorators`, each setting an explicit `operationId` rather than accepting the `ControllerName_method` default (FR-006, research R6)
- [X] T025 [US1] Document the creation operation in `src/docs/order-api.decorators.ts`: request body referencing `CreateOrderRequest`, the 201 and 200 responses, and the 400 and 409 failures with their codes (FR-014, FR-032, FR-045)
- [X] T026 [US1] Document the retrieval operation in `src/docs/order-api.decorators.ts`: the positive-integer path parameter, the 200, and the 400 and 404 failures, recording that a non-numeric identifier is malformed rather than missing (FR-020)
- [X] T027 [US1] Document the listing operation in `src/docs/order-api.decorators.ts`: the three query parameters derived from the live schema, the rejection of out-of-range and unrecognised parameters, and the continuation token's absence on the final page (FR-018, FR-019, FR-026, FR-028)
- [X] T028 [US1] Document the cancellation operation in `src/docs/order-api.decorators.ts`: no request body, the 200, and the 409 described as covering both a late caller and an always-illegal transition (FR-021, FR-039)
- [X] T029 [P] [US1] Create `src/docs/health-api.decorators.ts` documenting the health check at its unversioned path with its 200 and its 503, the one status outside the order API's closed set (FR-003, FR-040)
- [X] T030 [US1] Apply the composed decorators and `@ApiTags('Orders')` to `src/orders/orders.controller.ts`, one decorator per route, changing no behaviour (FR-069, FR-070)
- [X] T031 [US1] Apply the composed decorator and `@ApiTags('Operations')` to `src/health/health.controller.ts`, changing no behaviour (FR-069, FR-070)
- [X] T032 [US1] Document line ordering, the derived nature of `totalMinor`, and the price-capture guarantee on the order representation in `src/docs/openapi.schemas.ts` (FR-025, FR-029)
- [X] T033 [US1] Add the document-level statement that no update or delete operation exists and why, so the absence reads as a decision (FR-005)
- [X] T034 [US1] Add the document-level statement that the failure code is the stable machine-readable part of an error and the message is not, and that no error body carries a stack trace, driver message, query fragment or filesystem path (FR-035, FR-037)
- [X] T035 [US1] Document validation failures as carrying per-field detail and other failures as carrying an empty detail list (FR-036)

**Checkpoint**: The published contract is complete and accurate. User Story 1 is independently
deliverable.

---

## Phase 4: User Story 2 - Try the API From the Browser (Priority: P2)

**Goal**: Every documented operation is executable from the page, against the real service, with
prefilled examples that succeed on first use.

**Independent Test**: With the service running and the catalog seeded, complete create, read, list and
cancel from the browser alone.

### Tests for User Story 2

- [X] T036 [P] [US2] Write `test/integration/docs/playground.spec.ts` asserting `/docs` serves HTML, `/docs-json` serves the document, and `/docs-yaml` responds, all three outside the version prefix (FR-049, FR-060)
- [X] T037 [P] [US2] Write `test/integration/docs/prefix.spec.ts` asserting `/api/v1/docs` and `/api/v1/docs-json` return 404 while the unprefixed paths return 200, so a later `useGlobalPrefix` change fails loudly (FR-060a)
- [X] T038 [P] [US2] Write `test/integration/docs/provoke-failures.spec.ts` driving every documented failure against the running service and asserting the observed status and code are the documented ones (FR-077, SC-003)
- [X] T039 [P] [US2] Write `test/integration/docs/headers.spec.ts` asserting the correlation response header is present on success and failure, that creation returns `Location` on 201 and `Idempotent-Replay` on a replayed 200, and that each is documented (FR-041, FR-042, FR-043, FR-044)
- [X] T040 [P] [US2] Write `test/integration/docs/seed-examples.spec.ts` asserting the seeding command still produces the identifiers the prefilled examples name (FR-053a)

### Implementation for User Story 2

- [X] T041 [US2] Pin the seeding command in `src/database/seed.ts` to a documented, stable set of customer and product identifiers, changing what it guarantees rather than what it writes (FR-053a)
- [X] T042 [US2] Attach the prefilled request examples to each operation in `src/docs/order-api.decorators.ts`, so every operation opens with a body that succeeds against a seeded catalog (FR-053)
- [X] T043 [US2] Document the `Idempotency-Key` header on creation with its length and character set and the consequence of omitting it, and note in the operation description that repeating without one creates a second order (FR-041, FR-054)
- [X] T044 [US2] Document the `X-Correlation-Id` request header and its echo-or-generate behaviour, and the correlation response header on every operation (FR-042, FR-043)
- [X] T045 [US2] Confirm no server list is emitted that points anywhere but the origin serving the document, so the page cannot execute against an environment the reader did not choose (FR-055, contract)
- [X] T046 [US2] Confirm no credential input is rendered by verifying no security scheme reaches the document, and record the absence in the document description rather than by omission (FR-046, FR-047, FR-048, FR-056)

**Checkpoint**: A reviewer can drive the whole API from a browser. SC-005 is now measurable.

---

## Phase 5: User Story 3 - Documentation That Cannot Silently Drift (Priority: P3)

**Goal**: The document changes with the implementation, or a check fails.

**Independent Test**: Change a validation bound and confirm the document follows with no separate
edit; hand-edit the export and confirm a check fails.

### Tests for User Story 3

- [X] T047 [P] [US3] Write `test/integration/docs/export-parity.spec.ts` asserting the document served at `/docs-json` and the committed `openapi.json` describe the same surface (FR-067, FR-083)
- [X] T048 [P] [US3] Write `test/integration/docs/response-conformance.spec.ts` driving every response-producing operation and parsing each real response through its strict documented schema, so an undocumented field and a documented-but-absent field both fail (FR-009, FR-012, research R10)
- [X] T049 [P] [US3] Extend `test/integration/docs/response-conformance.spec.ts` to cover the failure bodies and the health report, not only the success bodies (FR-031, FR-036)

### Implementation for User Story 3

- [X] T050 [US3] Create `scripts/export-openapi.ts` building the application graph and generating the document **without listening on a port**, in two modes: write the file, and compare it to the file and exit non-zero on a difference (FR-064, FR-066)
- [X] T051 [US3] Generate and commit `openapi.json` at the repository root (FR-065)
- [X] T052 [US3] Add the export check to the `check` script in `package.json` so a drifted document fails the same gate as a formatting, linting or type error (FR-066, SC-009)
- [X] T053 [US3] Serialise the document deterministically in `scripts/export-openapi.ts`, relying on the generation stability research R5 measured, and compare serialised text so the failure reads as a diff (FR-013, FR-065)

**Checkpoint**: Drift is mechanically impossible to ship. All three primary stories complete.

---

## Phase 6: User Story 4 - Take the Contract Somewhere Else (Priority: P4)

**Goal**: The machine-readable contract is obtainable, self-contained and reviewable without starting
the service.

**Independent Test**: Open the committed export from a clean checkout and load it in an independent
viewer.

- [X] T054 [P] [US4] Assert in `test/integration/docs/document-structure.spec.ts` that the document resolves every internal reference and holds no external one (FR-068, SC-008)
- [X] T055 [US4] Document how to obtain the export and what it is for in `README.md`, alongside the existing commands (FR-062)
- [X] T056 [US4] Verify the export is byte-reproducible by generating it twice from a clean checkout and comparing (SC-009)

**Checkpoint**: All four user stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The guarantees that belong to no single story, and the evidence that the tests are
load-bearing.

- [X] T057 [P] Write `test/integration/docs/non-interference.spec.ts` asserting the health endpoint's status, body and headers are identical with documentation mounted and not, which is the specific regression this project has already had once (FR-081, SC-007)
- [X] T058 [P] Write `test/integration/docs/disabled.spec.ts` asserting that with `DOCS_ENABLED=false` all three documentation paths report not found while the API is unaffected, and that the **string** `false` disables it (FR-059, FR-082, SC-010, research R13)
- [X] T059 Run the full pre-existing suite and confirm every Spec 001, 002 and 003 test passes **without modification**, treating any required edit as evidence of an unintended behaviour change rather than as a test needing adjustment (FR-075, SC-007)
- [X] T060 Confirm `npx drizzle-kit generate` reports no pending schema change, proving this feature added no persistence (FR-072)
- [X] T061 Run `npm run check` and confirm it exits 0 with the new export gate in place (FR-066)
- [X] T062 Run the mutation sweep: remove each documentation guarantee in turn and confirm the suite turns red for every one (FR-086, SC-011)
- [X] T063 [P] Record the mutation results in `test/integration/README.md`, in the same form Spec 003 used (FR-086)
- [X] T064 [P] Add the Spec 004 decisions to the `README.md` decision log, including the `addGlobalResponse` trap and the `z.coerce.boolean` trap, since both are defects that report success (research R7, R13)
- [X] T065 [P] Document reaching the page in `README.md` in the same place it documents starting the service (FR-062, FR-063)
- [X] T066 Walk every scenario in [quickstart.md](quickstart.md) against a running service and a throwaway database, and correct the document where reality differs (SC-005)
- [X] T067 Measure the suite's runtime across two consecutive runs and record the increment this feature adds (SC-012)
- [X] T068 Mark every task in this file `[X]` only after its verification has actually run, not after its code was written

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup; blocks every user story
- **User Story 1 (Phase 3)**: depends on Foundational
- **User Story 2 (Phase 4)**: depends on Foundational; its examples build on US1's decorators
- **User Story 3 (Phase 5)**: depends on Foundational; parity is only meaningful once US1 has content
- **User Story 4 (Phase 6)**: depends on US3's export existing
- **Polish (Phase 7)**: depends on everything

### Within Each User Story

Tests are written before the implementation they cover and are expected to fail first. The document is
the thing under test, so a test written afterwards tends to describe whatever was generated rather
than what was required.

### Parallel Opportunities

- T003, T004, T005 in Setup
- T011 alongside T012 to T014 in Foundational, since examples and the builder touch different files
- All six US1 test files (T018 to T023), all five US2 test files (T036 to T040), and all three US3 test files (T047 to T049)
- T029 alongside the order decorator tasks, since the health decorators live in their own file
- T057 and T058 in Polish, and the four documentation tasks T063 to T065

### Sequential Constraints Worth Naming

- T024 to T028 all edit `src/docs/order-api.decorators.ts` and must not run in parallel with each other
- T006 to T010 all edit `src/docs/openapi.schemas.ts` and must not run in parallel with each other
- T051 must follow T050, and T052 must follow T051
- T062 must run alone. The sweep mutates files in place and restores them at the end, so a commit taken mid-sweep captures a mutated file. That happened once in Spec 003

---

## Implementation Strategy

### MVP First

1. Phase 1 and Phase 2.
2. Phase 3, User Story 1.
3. **Stop and validate**: the published contract is complete and accurate, and the coverage,
   convention and failure assertions pass. This alone satisfies the specification's primary purpose.

### Incremental Delivery

1. Setup and Foundational: a document exists.
2. Add US1: the document is complete and correct. Deliverable.
3. Add US2: the document is executable. Deliverable.
4. Add US3: the document cannot drift. Deliverable.
5. Add US4: the document travels.

### What "Done" Means Here

A documentation feature can look finished while being wrong, which is the failure mode this task list
is shaped against. The gate is not that the page renders; it is that T018 to T023, T036 to T040, T047
to T049, T057 and T058 all pass, and that T062's mutation sweep shows every one of them is
load-bearing. A green suite with a mutation that does not turn it red means the assertion was
decorative.

---

## Notes

- Every task names its requirement, so a reviewer can go from a line of the specification to the task
  that discharged it and the test that proves it.
- `[P]` means a different file and no dependency on incomplete work.
- Do not commit while T062 is running.
