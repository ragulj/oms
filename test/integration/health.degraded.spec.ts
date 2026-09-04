import request from 'supertest';
import { createTestApp, type TestHarness } from '../setup/test-app';

/**
 * User Story 1, scenario 4. FR-015 governs the startup case only, so a database
 * lost after a successful boot is exactly what this failure response is for.
 */
describe('health check when the database becomes unreachable after startup', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('returns a failure status naming the database', async () => {
    await request(harness.app.getHttpServer()).get('/health').expect(200);

    harness.connection.close();

    const response = await request(harness.app.getHttpServer()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.dependencies.database).toBe('unhealthy');
  });
});
