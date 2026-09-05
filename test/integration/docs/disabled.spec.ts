import request from 'supertest';
import type { Server } from 'node:http';
import { loadConfig } from '../../../src/config/configuration';
import { DOCUMENTATION_PATHS } from '../../../src/docs/openapi.document';
import { createTestApp, type TestHarness } from '../../setup/test-app';
import { TEST_DB_PATH } from '../../setup/database';

/**
 * FR-059, FR-082, SC-010. With documentation disabled every documentation path
 * reports not found, and the API is untouched.
 *
 * The last group is the reason this file exists rather than a single assertion.
 * `DOCS_ENABLED` arrives from the environment as the **string** `'false'`, and
 * `z.coerce.boolean()` would turn that into `true`, because every non-empty
 * string is truthy in JavaScript. The setting would then read as honoured, the
 * page would be served, the logs would say nothing, and the only symptom would
 * be documentation reachable in a deployment that had switched it off. Research
 * R13 measured this; `z.stringbool()` is the fix, and these cases are what stop
 * a later contributor from "simplifying" it back.
 */
describe('documentation can be switched off', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp({ DOCS_ENABLED: 'false' });
  });

  afterAll(async () => {
    await harness.close();
  });

  const server = (): Server => harness.app.getHttpServer() as Server;

  it('builds no document at all, rather than building one and hiding it', () => {
    expect(harness.document).toBeUndefined();
  });

  it.each([...DOCUMENTATION_PATHS])('reports not found for %s (FR-059)', async (path) => {
    const response = await request(server()).get(path);
    expect(`${path} -> ${response.status}`).toBe(`${path} -> 404`);
  });

  it('reports not found for the page assets too, not only its index', async () => {
    const response = await request(server()).get('/docs/swagger-ui-bundle.js');
    expect(response.status).toBe(404);
  });

  it('leaves the API completely unaffected (FR-082)', async () => {
    const listing = await request(server()).get('/api/v1/orders');
    expect(listing.status).toBe(200);
    expect(listing.body.orders).toEqual([]);

    const health = await request(server()).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('healthy');
  });

  /**
   * A disabled path must be indistinguishable from a path that was never
   * routed. Anything else — a distinctive body, a different status, a header
   * the ordinary miss does not carry — would tell a caller that documentation
   * exists here and is being withheld, which is a different statement from the
   * one the setting makes.
   */
  it('answers a documentation path exactly as it answers any unrouted path', async () => {
    const documentation = await request(server()).get('/docs-json');
    const neverRouted = await request(server()).get('/not-a-route-at-all');

    expect(documentation.status).toBe(neverRouted.status);
    expect(Object.keys(documentation.body).sort()).toEqual(Object.keys(neverRouted.body).sort());
    expect(documentation.headers['content-type']).toBe(neverRouted.headers['content-type']);
  });

  describe('the string "false" disables it (SC-010, research R13)', () => {
    const config = (value: string): boolean =>
      loadConfig({ DATABASE_PATH: TEST_DB_PATH, DOCS_ENABLED: value } as NodeJS.ProcessEnv)
        .DOCS_ENABLED;

    it('parses "false" as false, which truthiness coercion would not', () => {
      expect(config('false')).toBe(false);
    });

    it('parses "true" as true', () => {
      expect(config('true')).toBe(true);
    });

    it('defaults to true when unset, so the page is on unless switched off', () => {
      expect(loadConfig({ DATABASE_PATH: TEST_DB_PATH } as NodeJS.ProcessEnv).DOCS_ENABLED).toBe(
        true,
      );
    });

    it('rejects a value that is neither, rather than guessing', () => {
      expect(() => config('yes please')).toThrow();
      expect(() => config('')).toThrow();
    });
  });
});
