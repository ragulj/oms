import {
  createDocsHarness,
  documentedOperations,
  isExcludedRoute,
  routedOperations,
  type DocsHarness,
} from '../../support/docs-fixtures';

/**
 * FR-076, SC-001. The assertion that makes every other documentation claim worth
 * something: the document describes the routes the service actually serves, in
 * both directions. An undocumented route is a gap; a documented route that does
 * not exist is a lie a reader would act on.
 */
describe('documented operations match routed operations', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const key = (operation: { method: string; path: string }): string =>
    `${operation.method} ${operation.path}`;

  it('documents every route the service serves', () => {
    const routed = routedOperations(harness.server)
      .filter((route) => !isExcludedRoute(route.path))
      .map(key)
      .sort();
    const documented = documentedOperations(harness.document).map(key).sort();

    expect([...new Set(routed)]).toEqual([...new Set(documented)]);
  });

  it('serves every route the document describes', () => {
    const routed = new Set(routedOperations(harness.server).map(key));
    for (const operation of documentedOperations(harness.document)) {
      expect(routed.has(key(operation))).toBe(true);
    }
  });

  it('covers the five expected operations and no others', () => {
    expect(documentedOperations(harness.document).map(key).sort()).toEqual([
      'GET /api/v1/orders',
      'GET /api/v1/orders/{id}',
      'GET /health',
      'POST /api/v1/orders',
      'POST /api/v1/orders/{id}/cancel',
    ]);
  });

  it('documents the health endpoint outside the version prefix', () => {
    const paths = Object.keys(harness.document.paths ?? {});
    expect(paths).toContain('/health');
    expect(paths).not.toContain('/api/v1/health');
  });

  it('describes no operation that updates or deletes an order (FR-005)', () => {
    const methods = documentedOperations(harness.document).map((operation) => operation.method);
    expect(methods).not.toContain('PUT');
    expect(methods).not.toContain('PATCH');
    expect(methods).not.toContain('DELETE');
  });

  it('gives every operation an explicit identifier rather than the framework default', () => {
    for (const operation of documentedOperations(harness.document)) {
      expect(operation.operationId).not.toMatch(/Controller_/);
      expect(operation.operationId.length).toBeGreaterThan(0);
    }
  });
});
