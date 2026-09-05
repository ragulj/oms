# Order Processing System

This take home assessment is pretty open ended, so my first step was to set clear technical and business boundaries. Throughout this assignment, I will compare how I would handle this in a real world production environment versus a scoped assessment.

## AI and Workflow

I have been using a custom agent kit for SDD along with Claude for the last few months, but that repository is private and company owned. For the current complexity of this assignment, I am plainly relying on the proven open source `spec-kit` from GitHub without any customizations.

In a real scenario, I would clarify the nature of the business, edge cases, and technical context as `SKILLS`. I would also bake language specific best practices into the agent module to help automate things. To accommodate the time constraints of this test, I am just relying on just in time prompts to guide the AI.

## Tech Stack

I am going with Node.js and the NestJS framework. I agree that for a take home assessment, NestJS is not exactly lightweight and usually requires a lot of boilerplate. However, since I am relying on AI for the setup, the usual cons and setup time are essentially eliminated.

I chose Node without any rigid criteria. In the real world, picking a stack requires assessing multiple factors like driver availability, ORM support, third party integrations, and the existing ecosystem. For this specific assessment, we just do not have enough data to mandate one over the other. Furthermore, in the post AI era, the learning curve for jumping into any of these stacks is drastically reduced.

## Living Document

This README will act as a living document. As development progresses, I will log all architectural tradeoffs, out-of-scope decisions, and any specific challenges faced while using the AI spec-kit right here.

## Getting Started

Requires **Node 22 or newer**. That floor is derived rather than pinned: it is the highest
minimum any direct dependency declares, and `better-sqlite3` sets it at 22, above NestJS at 20.
The service refuses to start on anything lower rather than failing obscurely later.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run start:dev
```

Then check `http://localhost:3000/health`. No database server to install and no C++ toolchain
required: the SQLite driver ships prebuilt binaries.

### Commands

| Command | What it does |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run start:dev` | Run the service from TypeScript sources |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build |
| `npm run db:generate` | Generate a migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm test` | Run the integration suite against a real database |
| `npm run check` | Format, lint, and type check. Non-zero exit on any violation |
| `npm run fix` | Correct what can be corrected mechanically |

### Configuration

Every setting the service recognises is listed in `.env.example`. All of them are validated at
startup, before traffic is accepted or work is scheduled, and a missing or malformed value
exits non-zero naming the offender.

`DATABASE_PATH` is required. `PORT`, `LOG_LEVEL`, `SCHEDULER_INTERVAL_MS`, and
`SHUTDOWN_DRAIN_TIMEOUT_MS` default to 3000, `info`, five minutes, and ten seconds.

### Two deliberate behaviours worth knowing

**Migrations are never applied at startup.** The service refuses to boot while any migration is
pending and names it. On a single-writer engine, two processes racing to migrate on boot is a
real hazard, so applying them is always an explicit command.

**Logs are structured in every environment**, with no pretty-printing branch, so what a test
asserts on is exactly what you read. Pipe through a formatter locally if you want colour.

## Architectural Decisions and AI Workflow Log

Where I overrode the AI's first instinct, and why.

| Area | Phase |  AI Initial Idea | My Implementation | The Reason |
| :--- | :--- | :--- | :--- | :--- |
| **Status Updates** | Brainstorm | Loop in Node, then one massive SQL update. | Batched SQL updates with a hard limit per tick. | Massive updates lock the database (bloated index, too many records, etc.). Endless loops block the Node event loop. |
| **Money Format** | Brainstorm | Decimals or floats. | Integers only (minor units like paise or cents). | Prevents rounding errors from floating point math. |
| **Business Scope** | Brainstorm | Left open. | Single country and currency. | Multi currency logic adds unnecessary complexity for a basic CRUD test. |
| **Database** | Constitution | PostgreSQL, because the concurrency rules it drafted assumed row level locking. | SQLite in WAL mode with a non-zero `busy_timeout`. | A single file database with nothing to provision is the right weight for a take home. The tradeoff is accepted openly: SQLite has one writer, so the app is explicitly single process and horizontal scaling is out of scope. |
| **ORM** | Constitution | TypeORM, the NestJS default. | Drizzle. | Drizzle stays a query builder rather than an ActiveRecord, so the conditional update and its changed row count remain visible at the call site. That count is what the 409 response is decided from, and TypeORM abstracts away exactly that detail. |
| **Job Claim** | Constitution | A CTE using `FOR UPDATE SKIP LOCKED`. | Bounded primary key claim with `LIMIT`, each chunk committed in its own transaction. | SQLite has no row level locking, so `SKIP LOCKED` does not exist to be used. The intent survives the rewrite, the mechanism does not. The iteration cap matters more here, not less, because the common Node SQLite drivers are synchronous and block the event loop for the length of every chunk. |
| **Cross-cutting middleware** | Setup | Add authentication, RBAC guards, feature guards, and logging middleware. | Deliberately exclude them from this assessment. | These concerns are important in a production service, but they do not affect the order-processing behavior being evaluated here (Customer Identification layer is skipped here). Omitting them keeps the implementation focused and reduces setup complexity. The service remains intentionally unauthenticated and single-purpose within the stated take-home scope. |
| **Reference domain entities** | Setup | N/A | Create only minimal Customer and Product reference tables required by the order foreign keys. Product carries only the scalar current unit price needed to demonstrate captured order pricing; no catalog subsystem is implemented. | The assessment evaluates order persistence and lifecycle behavior, not catalog ownership. Discounts and adjustments, tax, billing and shipping addresses, and payment models or entities are deliberately out of scope. |
| **Order Deletion** | Spec 002 | Line items deletable, with cancellation acting as a soft delete. | A `BEFORE DELETE` trigger refuses deletion outright, on the same terms as update. | A deletion rewrites financial history exactly as effectively as an update, so a rule naming only one verb protects nothing the other cannot reach. The consequence is that a stored order is permanent, which is what makes cancellation the lifecycle's only answer to an unwanted order. This forced constitution amendment v2.1.0, because Principle VI had mandated `DELETE FROM` for test isolation on tables that now refuse it. |
| **Trigger Ownership** | Spec 002 | Enforce line item immutability with a Drizzle level guard. | SQLite triggers, shipped in a hand written migration. | An application layer rule is one forgotten code path away from rewriting financial history. Drizzle has no trigger construct, so the DDL lives in a `drizzle-kit generate --custom` migration. That is the one deviation Spec 002 records, because the schema modules stop being the complete source of truth. |
| **Order Total** | Spec 002 | Store a `total_minor` column on the order. | Derive it by summing line totals, and fail loudly when the sum is not exactly representable. | A stored total is a second source of truth that can disagree with its own lines. The sum is also the one monetary value no column constraint can bound, because it spans rows with an unknown term count, so two individually conforming line totals can exceed the ceiling between them. |
| **Idempotency Cleanup** | Spec 003 | N/A | Idempotency records are retained indefinitely. Cleanup policy and expiry are deferred. | The timestamp is retained for a future retention policy, but no cleanup job is needed for this assessment. |
| **Database Error Classification** | Spec 003 | N/A | SQLite and `better-sqlite3` error classification remain implementation-specific. | The current persistence engine is intentionally SQLite, so a database adapter abstraction is deferred. |
| **Internal Failure Observability** | Spec 003 | N/A | Clients receive only a generic `INTERNAL_ERROR` response and correlation ID. Production centralised logging, alerting, audit, and error monitoring are deferred. | Internal details remain in structured application logs. Health reports dependency availability rather than exposing exception details. |
| **Customer Authentication** | Spec 003 | N/A | Authentication, authorisation, and tenant isolation are excluded. Idempotency keys remain globally unique for this unauthenticated scope. | Customer identity is intentionally limited to the request model for this assessment. |
