import request from 'supertest';
import type { Server } from 'node:http';
import { seed } from '../../src/database/seed';
import { createTestApp, type TestHarness } from '../setup/test-app';

export interface Catalog {
  customerId: number;
  productId: number;
  otherProductId: number;
}

export interface LifecycleHarness extends TestHarness {
  server: Server;
  /** Re-seeded per test, because the per-test hook clears these tables. */
  catalog(): Catalog;
  records(message: string): Record<string, unknown>[];
  /**
   * Captured log lines accumulate for the lifetime of the harness, which is the
   * whole file, while row identifiers restart at 1 after each per-test rebuild.
   * A test that matches a record on `orderId` can therefore find an earlier
   * test's record. Either clear between tests or match on the correlation
   * identifier, which is unique per request.
   */
  clearLogs(): void;
}

/**
 * FR-101. Drives the real application graph over HTTP against the real
 * database. Nothing here is mocked, because the guarantees under test are
 * concurrency and precision guarantees that a mocked repository cannot exhibit.
 */
export async function createLifecycleHarness(
  env: Record<string, string> = {},
): Promise<LifecycleHarness> {
  const harness = await createTestApp(env);

  return {
    ...harness,
    server: harness.app.getHttpServer() as Server,
    catalog: () => {
      const { customerIds, productIds } = seed(harness.connection);
      return {
        customerId: customerIds[0]!,
        productId: productIds[0]!,
        otherProductId: productIds[1]!,
      };
    },
    records: (message: string) =>
      harness.logLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) => record.message === message),
    clearLogs: () => {
      harness.logLines.length = 0;
    },
  };
}

export const api = (harness: LifecycleHarness) => ({
  create: (body: unknown, headers: Record<string, string> = {}) => {
    const call = request(harness.server).post('/api/v1/orders');
    for (const [name, value] of Object.entries(headers)) {
      void call.set(name, value);
    }
    return call.send(body as object);
  },
  get: (id: number | string) => request(harness.server).get(`/api/v1/orders/${id}`),
  list: (query = '') => request(harness.server).get(`/api/v1/orders${query}`),
  cancel: (id: number | string) => request(harness.server).post(`/api/v1/orders/${id}/cancel`),
});

/** A valid creation body, so each test states only the part it is varying. */
export function orderBody(
  catalog: Catalog,
  lines: { productId: number; quantity: number }[] = [
    { productId: catalog.productId, quantity: 3 },
  ],
): { customerId: number; lines: { productId: number; quantity: number }[] } {
  return { customerId: catalog.customerId, lines };
}
