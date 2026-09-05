import request from 'supertest';
import { createDocsHarness, type DocsHarness } from '../../support/docs-fixtures';
import { DOCUMENTATION_PATHS } from '../../../src/docs/openapi.document';

/**
 * FR-049, FR-055, FR-060. The page is served, the machine-readable document is
 * served, and both come from the same origin as the API so no cross-origin
 * configuration exists to get wrong.
 */
describe('the documentation is served', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('serves an interactive page at /docs', async () => {
    const response = await request(harness.server).get('/docs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toMatch(/swagger/i);
  });

  it('serves the machine-readable document at /docs-json', async () => {
    const response = await request(harness.server).get('/docs-json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths)).toHaveLength(4);
  });

  it('also answers on the YAML route the library registers unconditionally', async () => {
    // research R3: this route cannot be switched off, only renamed. It is
    // asserted here so that it is a known part of the surface rather than a
    // reachable path nobody accounted for.
    const response = await request(harness.server).get('/docs-yaml');
    expect(response.status).toBe(200);
  });

  it('enumerates every documentation path it serves', async () => {
    for (const path of DOCUMENTATION_PATHS) {
      const response = await request(harness.server).get(path);
      expect(`${path} -> ${response.status}`).toBe(`${path} -> 200`);
    }
  });

  it('emits no server override, so the page executes against its own origin (FR-055)', async () => {
    const response = await request(harness.server).get('/docs-json');
    expect(response.body.servers ?? []).toHaveLength(0);
  });

  it('leaves the API reachable exactly as before', async () => {
    const response = await request(harness.server).get('/api/v1/orders');

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(50);
    expect(response.body.orders).toEqual([]);
  });
});
