import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customers, products } from '../../../src/database/schema';
import { runMigrations } from '../../../src/database/migrate';
import { EXAMPLE_CUSTOMER_ID, EXAMPLE_PRODUCT_IDS, seed } from '../../../src/database/seed';
import { createOrderRequestExample } from '../../../src/docs/openapi.examples';
import { api } from '../../support/http-fixtures';
import { createDocsHarness, type DocsHarness } from '../../support/docs-fixtures';

/**
 * FR-053a. The prefilled example on the page names identifiers, and those
 * identifiers only exist because the seeding command created them. That is a
 * coupling between two artifacts no compiler checks: reordering `SEED_PRODUCTS`
 * in `seed.ts` would leave everything type-correct and every other test green,
 * while the first thing a reviewer executes from the page returned
 * `PRODUCT_NOT_FOUND`.
 *
 * This file owns its own database rather than sharing the suite's. The
 * guarantee under test is what the seed produces against a **fresh** database,
 * which is the state the quickstart puts a reviewer in, and the shared database
 * is not fresh: the per-test hook clears these tables with `DELETE FROM`, which
 * leaves SQLite's autoincrement sequence where it was, so a seed there returns
 * whatever numbers the run has reached. Asserting `1` against that would have
 * meant asserting against test-execution order.
 *
 * The last case is the one that matters most. It compares no constants; it
 * sends the published example body to the real endpoint and requires a 201.
 */
describe('the prefilled examples resolve against a seeded catalog', () => {
  let harness: DocsHarness;
  let databaseDir: string;

  beforeAll(async () => {
    databaseDir = mkdtempSync(join(tmpdir(), 'oms-seed-examples-'));
    const databasePath = join(databaseDir, 'fresh.db');
    runMigrations(databasePath);

    harness = await createDocsHarness({ DATABASE_PATH: databasePath });
  });

  afterAll(async () => {
    await harness.close();
    rmSync(databaseDir, { recursive: true, force: true });
  });

  it('produces the customer identifier the examples name', () => {
    const { customerIds } = seed(harness.connection);
    expect(customerIds[0]).toBe(EXAMPLE_CUSTOMER_ID);
  });

  it('produces the product identifiers the examples name', () => {
    const { productIds } = seed(harness.connection);
    expect(productIds.slice(0, EXAMPLE_PRODUCT_IDS.length)).toEqual([...EXAMPLE_PRODUCT_IDS]);
  });

  it('leaves those rows actually present, not merely numbered', () => {
    seed(harness.connection);

    const customerRows = harness.connection.db.select({ id: customers.id }).from(customers).all();
    const productRows = harness.connection.db.select({ id: products.id }).from(products).all();

    expect(customerRows.map((row) => row.id)).toContain(EXAMPLE_CUSTOMER_ID);
    for (const productId of EXAMPLE_PRODUCT_IDS) {
      expect(productRows.map((row) => row.id)).toContain(productId);
    }
  });

  it('is re-runnable without duplicating or renumbering (FR-053a)', () => {
    const first = seed(harness.connection);
    const second = seed(harness.connection);

    expect(second).toEqual(first);
    expect(second.customerIds[0]).toBe(EXAMPLE_CUSTOMER_ID);
  });

  it('keeps the published example pointing at those identifiers', () => {
    expect(createOrderRequestExample.customerId).toBe(EXAMPLE_CUSTOMER_ID);
    expect(createOrderRequestExample.lines.map((line) => line.productId)).toEqual([
      ...EXAMPLE_PRODUCT_IDS,
    ]);
  });

  it('serves that example in the document rather than a different one', () => {
    const operation = harness.document.paths?.['/api/v1/orders']?.post;
    const body = operation?.requestBody as
      { content?: Record<string, { examples?: Record<string, { value?: unknown }> }> } | undefined;

    expect(body?.content?.['application/json']?.examples?.default?.value).toEqual(
      createOrderRequestExample,
    );
  });

  it('succeeds when executed exactly as the page would send it (SC-005)', async () => {
    seed(harness.connection);

    const response = await api(harness).create(createOrderRequestExample);

    expect(response.status).toBe(201);
    expect(response.body.customerId).toBe(EXAMPLE_CUSTOMER_ID);
    expect(response.body.lines).toHaveLength(createOrderRequestExample.lines.length);
  });
});
