import request from 'supertest';
import { CORRELATION_HEADER } from '../../../src/http/correlation';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '../../../src/database/schema/idempotency-records';
import { IDEMPOTENT_REPLAY_HEADER } from '../../../src/orders/orders.controller';
import { api, orderBody } from '../../support/http-fixtures';
import {
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';

/**
 * FR-041 to FR-044. Every header the API sends or accepts is documented, and
 * every header the document names is one a real response actually carries.
 *
 * Both directions matter. A documented header nobody sends is a lie a caller
 * will build a branch on; a sent header nobody documented is a signal a caller
 * cannot know to read. `Idempotent-Replay` is the sharp case: a caller who does
 * not know it exists has to compare bodies to tell a replay from a creation,
 * and the bodies are identical.
 */
describe('the headers are documented and the documented headers are sent', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** The response header names the document promises for one operation and status. */
  const documentedHeaders = (operationId: string, status: number): string[] => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!operation) throw new Error(`No operation documented with id ${operationId}.`);

    const responses = operation.operation.responses as Record<string, JsonRecord>;
    const response = responses[String(status)];
    if (!response) throw new Error(`Operation ${operationId} documents no ${status} response.`);

    return Object.keys((response.headers ?? {}) as JsonRecord).sort();
  };

  /** The request header names the document accepts for one operation. */
  const documentedRequestHeaders = (operationId: string): string[] => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === operationId,
    );
    if (!operation) throw new Error(`No operation documented with id ${operationId}.`);

    const parameters = (operation.operation.parameters ?? []) as JsonRecord[];
    return parameters
      .filter((parameter) => parameter.in === 'header')
      .map((parameter) => String(parameter.name))
      .sort();
  };

  describe('the correlation identifier (FR-042, FR-043)', () => {
    it('is documented as an optional request header on creation', () => {
      expect(documentedRequestHeaders('createOrder')).toContain('X-Correlation-Id');

      const parameters = (documentedOperations(harness.document).find(
        (candidate) => candidate.operationId === 'createOrder',
      )!.operation.parameters ?? []) as JsonRecord[];
      const correlation = parameters.find((parameter) => parameter.name === 'X-Correlation-Id');
      expect(correlation?.required).toBeFalsy();
      expect(String(correlation?.description)).toMatch(/echoed|generated/i);
    });

    it('is echoed when well formed', async () => {
      const supplied = 'correlation-from-the-caller';
      const response = await request(harness.server)
        .get('/api/v1/orders')
        .set(CORRELATION_HEADER, supplied);

      expect(response.status).toBe(200);
      expect(response.headers[CORRELATION_HEADER]).toBe(supplied);
    });

    it('is generated when absent', async () => {
      const response = await api(harness).list();

      expect(response.status).toBe(200);
      expect(response.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
      expect(String(response.headers[CORRELATION_HEADER]).length).toBeGreaterThan(0);
    });

    it('is present on a failure too, which is when it matters most', async () => {
      const response = await api(harness).get(999_999);

      expect(response.status).toBe(404);
      expect(response.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
      expect(response.body.correlationId).toBe(response.headers[CORRELATION_HEADER]);
    });

    it('is documented on every order response, success and failure alike', () => {
      for (const operation of documentedOperations(harness.document)) {
        if (operation.path === '/health') continue;

        const responses = operation.operation.responses as Record<string, JsonRecord>;
        for (const [status, response] of Object.entries(responses)) {
          const headers = Object.keys((response.headers ?? {}) as JsonRecord);
          expect(`${operation.operationId} ${status} -> ${headers.join(',')}`).toContain(
            'X-Correlation-Id',
          );
        }
      }
    });
  });

  describe('Location on creation (FR-044)', () => {
    it('is sent on a 201 and points at the created order', async () => {
      const catalog = harness.catalog();
      const response = await api(harness).create(orderBody(catalog));

      expect(response.status).toBe(201);
      expect(response.headers.location).toBe(`/api/v1/orders/${response.body.id}`);
    });

    it('leads somewhere real, which is the only claim a Location makes', async () => {
      const catalog = harness.catalog();
      const created = await api(harness).create(orderBody(catalog));

      const followed = await api(harness).get(
        String(created.headers.location).replace('/api/v1/orders/', ''),
      );
      expect(followed.status).toBe(200);
      expect(followed.body.id).toBe(created.body.id);
    });

    it('is documented on the 201 and nowhere else', () => {
      expect(documentedHeaders('createOrder', 201)).toContain('Location');
      expect(documentedHeaders('createOrder', 200)).not.toContain('Location');
    });
  });

  describe('Idempotent-Replay on a replayed creation (FR-041, FR-044)', () => {
    it('is absent on the original and present on the replay', async () => {
      const catalog = harness.catalog();
      const key = 'headers-spec-replay-key';
      const body = orderBody(catalog);

      const original = await api(harness).create(body, { 'Idempotency-Key': key });
      expect(original.status).toBe(201);
      expect(original.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()]).toBeUndefined();

      const replay = await api(harness).create(body, { 'Idempotency-Key': key });
      expect(replay.status).toBe(200);
      expect(replay.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()]).toBe('true');

      // The header is the whole signal: the bodies are identical.
      expect(replay.body).toEqual(original.body);
    });

    it('is documented on the 200 and nowhere else', () => {
      expect(documentedHeaders('createOrder', 200)).toContain(IDEMPOTENT_REPLAY_HEADER);
      expect(documentedHeaders('createOrder', 201)).not.toContain(IDEMPOTENT_REPLAY_HEADER);
    });

    it('documents the request header with its length and character set', () => {
      const parameters = (documentedOperations(harness.document).find(
        (candidate) => candidate.operationId === 'createOrder',
      )!.operation.parameters ?? []) as JsonRecord[];
      const key = parameters.find((parameter) => parameter.name === 'Idempotency-Key');

      expect(key).toBeDefined();
      expect(key!.required).toBeFalsy();

      const schema = key!.schema as JsonRecord;
      expect(schema.minLength).toBe(IDEMPOTENCY_KEY_MIN_LENGTH);
      expect(schema.maxLength).toBe(IDEMPOTENCY_KEY_MAX_LENGTH);
      expect(String(key!.description)).toMatch(/without|omitting/i);
    });

    it('states the consequence of omitting the key on the operation itself (FR-054)', () => {
      const operation = documentedOperations(harness.document).find(
        (candidate) => candidate.operationId === 'createOrder',
      )!;
      // The description is wrapped, so the phrase can straddle a newline.
      expect(String(operation.operation.description)).toMatch(/two\s+orders|second\s+order/i);
    });

    it('creates a second order when the key is omitted, exactly as documented', async () => {
      const catalog = harness.catalog();
      const body = orderBody(catalog);

      const first = await api(harness).create(body);
      const second = await api(harness).create(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
    });
  });

  it('documents no response header the API does not send', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(orderBody(catalog));
    const sent = Object.keys(created.headers).map((name) => name.toLowerCase());

    for (const header of documentedHeaders('createOrder', 201)) {
      expect(`201 sends ${header}: ${sent.includes(header.toLowerCase())}`).toBe(
        `201 sends ${header}: true`,
      );
    }
  });
});
