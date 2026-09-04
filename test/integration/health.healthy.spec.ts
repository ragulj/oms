import request from 'supertest';
import { createTestApp, type TestHarness } from '../setup/test-app';

// User Story 1, scenario 1
describe('health check with a reachable database', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports healthy', async () => {
    const response = await request(harness.app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });

  it('serves the health check outside the versioned prefix (FR-035)', async () => {
    await request(harness.app.getHttpServer()).get('/health').expect(200);
    await request(harness.app.getHttpServer()).get('/api/v1/health').expect(404);
  });
});
