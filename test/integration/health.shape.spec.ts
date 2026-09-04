import request from 'supertest';
import { createTestApp, type TestHarness } from '../setup/test-app';

// User Story 1, scenario 2
describe('health check response shape', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports overall status and per-dependency database reachability', async () => {
    const response = await request(harness.app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({
      status: 'healthy',
      dependencies: { database: 'healthy' },
    });
  });
});
