import request from 'supertest';
import type { Server } from 'node:http';
import { CORRELATION_HEADER } from '../../../src/http/correlation';
import { createTestApp, type TestHarness } from '../../setup/test-app';

/**
 * FR-081, SC-007. Mounting the documentation changes nothing about the API.
 *
 * This is not a hypothetical. This project has already had exactly this
 * regression once, on the health endpoint, which is the endpoint least likely to
 * be re-checked after a documentation change and the one a supervisor watches.
 * Middleware a documentation library installs runs ahead of routing, and the
 * damage it does is invisible from the page it serves.
 *
 * Two applications are built, identical but for the setting, and their responses
 * are compared field by field rather than merely both being asserted to succeed.
 */
describe('mounting the documentation changes nothing about the API', () => {
  let withDocs: TestHarness;
  let withoutDocs: TestHarness;

  beforeAll(async () => {
    withDocs = await createTestApp({ DOCS_ENABLED: 'true' });
    withoutDocs = await createTestApp({ DOCS_ENABLED: 'false' });
  });

  afterAll(async () => {
    await withDocs.close();
    await withoutDocs.close();
  });

  const serverOf = (harness: TestHarness): Server => harness.app.getHttpServer() as Server;

  it('builds one application each way, so the comparison is real', () => {
    expect(withDocs.document).toBeDefined();
    expect(withoutDocs.document).toBeUndefined();
  });

  it('returns an identical health status and body (FR-081)', async () => {
    const documented = await request(serverOf(withDocs)).get('/health');
    const plain = await request(serverOf(withoutDocs)).get('/health');

    expect(documented.status).toBe(plain.status);
    expect(documented.body).toEqual(plain.body);
  });

  /**
   * Headers, not just the body. The regression this file exists for was a header
   * one: a body can be identical while the content type, the correlation header
   * or a caching header has changed under it.
   */
  it('returns identical health headers, ignoring the ones that must differ per request', async () => {
    const documented = await request(serverOf(withDocs)).get('/health');
    const plain = await request(serverOf(withoutDocs)).get('/health');

    // Correlation is unique per request by design, and Date and Etag follow the
    // body's clock and length rather than the documentation setting.
    const PER_REQUEST = new Set([CORRELATION_HEADER, 'date', 'etag']);
    const comparable = (headers: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(headers).filter(([name]) => !PER_REQUEST.has(name.toLowerCase())),
      );

    expect(comparable(documented.headers)).toEqual(comparable(plain.headers));
    // The correlation header is present either way; only its value differs.
    expect(documented.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
    expect(plain.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
  });

  it('returns identical order listings', async () => {
    const documented = await request(serverOf(withDocs)).get('/api/v1/orders');
    const plain = await request(serverOf(withoutDocs)).get('/api/v1/orders');

    expect(documented.status).toBe(plain.status);
    expect(documented.body).toEqual(plain.body);
  });

  it('returns identical failures, including status, code and detail shape', async () => {
    const documented = await request(serverOf(withDocs)).get('/api/v1/orders/999999');
    const plain = await request(serverOf(withoutDocs)).get('/api/v1/orders/999999');

    expect(documented.status).toBe(plain.status);
    expect(documented.body.code).toBe(plain.body.code);
    expect(documented.body.details).toEqual(plain.body.details);
    // Only the correlation identifier legitimately differs between the two.
    expect(Object.keys(documented.body).sort()).toEqual(Object.keys(plain.body).sort());
  });

  it('returns an identical not-found for an unrouted path', async () => {
    const documented = await request(serverOf(withDocs)).get('/api/v1/nothing-here');
    const plain = await request(serverOf(withoutDocs)).get('/api/v1/nothing-here');

    expect(documented.status).toBe(404);
    expect(documented.status).toBe(plain.status);
    expect(documented.body).toEqual(plain.body);
  });

  it('leaves the versioned prefix exactly where it was', async () => {
    for (const harness of [withDocs, withoutDocs]) {
      expect((await request(serverOf(harness)).get('/health')).status).toBe(200);
      expect((await request(serverOf(harness)).get('/api/v1/health')).status).toBe(404);
      expect((await request(serverOf(harness)).get('/orders')).status).toBe(404);
    }
  });
});
