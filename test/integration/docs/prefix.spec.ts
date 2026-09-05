import request from 'supertest';
import { createDocsHarness, type DocsHarness } from '../../support/docs-fixtures';

/**
 * FR-060a. The documentation paths sit outside the `/api/v1` prefix, and they do
 * so by default rather than by an exclusion anyone wrote: `useGlobalPrefix` is
 * left unset, and unset means off (research R3).
 *
 * That is exactly why this is a test. A default nobody chose is a default a
 * later contributor can flip while believing they are adding an option, and the
 * document would then move out from under every bookmark, README link and
 * startup log line that names it.
 */
describe('the documentation paths are not versioned', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it.each(['/docs', '/docs-json', '/docs-yaml'])('serves %s unprefixed', async (path) => {
    const response = await request(harness.server).get(path);
    expect(response.status).toBe(200);
  });

  it.each(['/api/v1/docs', '/api/v1/docs-json', '/api/v1/docs-yaml'])(
    'does not serve %s',
    async (path) => {
      const response = await request(harness.server).get(path);
      expect(response.status).toBe(404);
    },
  );

  it('keeps the health endpoint unprefixed too, and documents it that way', async () => {
    expect((await request(harness.server).get('/health')).status).toBe(200);
    expect((await request(harness.server).get('/api/v1/health')).status).toBe(404);
    expect(Object.keys(harness.document.paths ?? {})).toContain('/health');
  });

  it('keeps every order operation prefixed', () => {
    const orderPaths = Object.keys(harness.document.paths ?? {}).filter(
      (path) => path !== '/health',
    );
    expect(orderPaths.length).toBeGreaterThan(0);
    for (const path of orderPaths) {
      expect(path.startsWith('/api/v1/')).toBe(true);
    }
  });
});
