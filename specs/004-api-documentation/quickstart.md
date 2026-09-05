# Quickstart: API Documentation and Swagger Playground

**Feature**: [spec.md](spec.md) | **Contract**: [contracts/openapi-document.md](contracts/openapi-document.md)

Eight scenarios that prove the feature from outside the process. Scenarios 1 to 4 are what SC-005
measures: a reviewer who has never seen the system reaching a placed, read, listed and cancelled order
from a browser in under five minutes. Scenarios 5 to 8 are the guarantees a browser cannot show you.

## Prerequisites

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file:

```bash
cp .env.example .env
```

3. Apply migrations:

```bash
npm run db:migrate
```

4. Seed the catalog, and note the identifiers it prints:

```bash
npm run db:seed
```

Step 4 is not optional for this feature. The page's prefilled examples name the identifiers this
command creates, which is what makes a reviewer's first execution succeed rather than return a
missing-product error. FR-053a pins those identifiers so the examples cannot go stale.

5. Start the service:

```bash
npm run start:dev
```

## Scenario 1: Reach the page

1. Open `http://localhost:3000/docs`.

**Expected**: the interactive page lists five operations under two groups, Orders and Operations.
Every operation shows a summary, its parameters, its responses, and the failure codes it can emit.
There is no credential input anywhere on the page, and the security section states that the API
requires none.

The address also appears in the service's startup output, so it does not have to be guessed.

## Scenario 2: Place an order without composing a body

1. Expand **POST /api/v1/orders**.
2. Click **Try it out**. The request body is already filled with a valid example.
3. Click **Execute**.

**Expected**: 201. The response body is the stored order with a `pending` status, one or more line
items each carrying the catalog price, and a `totalMinor` equal to the sum of the line totals. The
response headers include `Location` naming the retrieval path and `X-Correlation-Id`.

Note what the body does **not** contain: no price you supplied, no formatted date, no decimal amount.
Every money value is an integer count of minor units and every timestamp is an integer count of
microseconds.

4. Click **Execute** a second time without changing anything.

**Expected**: 201 again, with a **different** identifier. Two orders now exist. That is correct: an
idempotency key is what prevents a duplicate, and the example does not send one.

5. Put any value of 8 or more characters into the `Idempotency-Key` field and execute twice.

**Expected**: 201 the first time, then **200** with an `Idempotent-Replay: true` response header and
the same order identifier as the first. The status code is the signal; the bodies are identical.

## Scenario 3: See a documented failure happen

1. In **POST /api/v1/orders**, change a line's `quantity` to `0` and execute.

**Expected**: 400, with `"code": "VALIDATION_FAILED"` and a `details` entry naming the offending
field. This is the same response any other client receives; the page is not a special path.

2. Add a `unitPriceMinor` property to a line and execute.

**Expected**: 400. The field is rejected rather than ignored. Confirm the documented request schema
said so: it shows `additionalProperties: false`, which is derived from the schema that actually
validates rather than written by hand.

3. Change `productId` to an identifier the seed did not create and execute.

**Expected**: 400 with `"code": "PRODUCT_NOT_FOUND"`, and no order stored.

## Scenario 4: Read, list and cancel

1. Expand **GET /api/v1/orders/{id}**, enter the identifier from Scenario 2, execute.

**Expected**: 200 and the same order.

2. Expand **GET /api/v1/orders**, execute with no parameters.

**Expected**: 200, newest first, `limit` reported as 50, and `nextCursor` either a string or `null`.
The cursor is opaque; the document does not describe its encoding and you should not decode it.

3. Set `limit` to `101` and execute.

**Expected**: 400. Out of range is rejected, never clamped.

4. Expand **POST /api/v1/orders/{id}/cancel**, enter the identifier, execute.

**Expected**: 200 and the order with status `cancelled`.

5. Execute the same cancellation again.

**Expected**: 409 with `"code": "TRANSITION_NOT_PERMITTED"`. The document says this covers both a
caller who was simply late and a transition that was never legal, because those are the same fact.

## Scenario 5: The documentation paths are not under the version prefix

```bash
curl -s -o /dev/null -w "%{http_code} /docs\n"       http://localhost:3000/docs
curl -s -o /dev/null -w "%{http_code} /docs-json\n"  http://localhost:3000/docs-json
curl -s -o /dev/null -w "%{http_code} /api/v1/docs\n" http://localhost:3000/api/v1/docs
```

**Expected**: `200`, `200`, `404`. The document describes the API rather than forming part of it, so
it does not move when the API version moves.

## Scenario 6: The served document matches the committed one

```bash
curl -s http://localhost:3000/docs-json -o /tmp/served.json && node -e "const a=require('fs').readFileSync('openapi.json','utf8'),b=require('fs').readFileSync('/tmp/served.json','utf8');console.log(JSON.stringify(JSON.parse(a))===JSON.stringify(JSON.parse(b))?'IDENTICAL':'DIFFERENT')"
```

**Expected**: `IDENTICAL`.

Then confirm the gate works:

```bash
npm run check
```

**Expected**: exits 0. Now hand-edit `openapi.json`, run it again, and expect a non-zero exit naming
the difference. Restore the file afterwards.

## Scenario 7: Documentation can be switched off

1. Stop the service.
2. Start it with documentation disabled:

```bash
DOCS_ENABLED=false npm run start:dev
```

3. Check all three documentation paths and one API path:

```bash
curl -s -o /dev/null -w "%{http_code} /docs\n"      http://localhost:3000/docs
curl -s -o /dev/null -w "%{http_code} /docs-json\n" http://localhost:3000/docs-json
curl -s -o /dev/null -w "%{http_code} /docs-yaml\n" http://localhost:3000/docs-yaml
curl -s -o /dev/null -w "%{http_code} /api/v1/orders\n" http://localhost:3000/api/v1/orders
```

**Expected**: `404`, `404`, `404`, `200`. All three, because the YAML route exists whether or not
anyone asked for it, and a disable that leaves one of the three reachable has not disabled anything.

The string `false` genuinely disables it. That is worth checking rather than assuming: the obvious way
to parse a boolean environment variable in this stack treats every non-empty string as true, so
`DOCS_ENABLED=false` would have enabled documentation with nothing in the logs to explain it.

## Scenario 8: Nothing else changed

```bash
curl -s http://localhost:3000/health
```

**Expected**: exactly the Spec 001 shape, `{"status":"healthy","dependencies":{"database":"healthy"}}`.
Not wrapped, not re-coded, not carrying an error envelope.

This is the specific regression this project has already had once, when a Spec 003 exception filter
registered globally rewrote this body. A documentation layer that mounts routes and static assets is
the same class of change, which is why it gets its own scenario and its own test.

## Teardown

1. Stop the service with Ctrl+C and expect `shutdown.started` followed by `shutdown.complete`.
2. Remove the seeded database if you want a clean slate:

```bash
rm -f data/oms.db data/oms.db-wal data/oms.db-shm
```
