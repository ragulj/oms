import {
  advertisedErrorCodes,
  createDocsHarness,
  documentedOperations,
  statusesOf,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';
import { ERROR_CODES } from '../../../src/http/api-error';

/**
 * FR-034, FR-038, FR-080, SC-002. Every failure the service can produce is
 * published, every operation names only the failures it can actually produce,
 * and no operation carries a 500.
 *
 * That last one is the point of this file. `DocumentBuilder.addGlobalResponse`
 * reads as though it documents a response once at document level and in fact
 * copies it into every operation (research R7). A contributor who reaches for it
 * would put an unprovokable response on all five operations, and SC-003 would
 * have to grow an exemption. This test is what stops that happening quietly.
 */
describe('failures are documented exactly as they can occur', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const operationBy = (operationId: string): JsonRecord => {
    const found = documentedOperations(harness.document).find(
      (operation) => operation.operationId === operationId,
    );
    if (!found) throw new Error(`No operation documented with id ${operationId}.`);
    return found.operation;
  };

  it('publishes every declared failure code (FR-080)', () => {
    const schemas = harness.document.components?.schemas as JsonRecord;
    const errorBody = schemas.ErrorBody as JsonRecord;
    const code = (errorBody.properties as JsonRecord).code as JsonRecord;

    expect((code.enum as string[]).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('lists no 500 on any operation (FR-038)', () => {
    for (const operation of documentedOperations(harness.document)) {
      expect(statusesOf(operation.operation)).not.toContain(500);
    }
  });

  it('describes the server-error possibility once, at document level', () => {
    expect(harness.document.info.description).toMatch(/`500`/);
    expect(harness.document.info.description).toMatch(
      /no input a caller can\s+construct produces/i,
    );
  });

  it('advertises only codes that exist', () => {
    for (const operation of documentedOperations(harness.document)) {
      for (const code of advertisedErrorCodes(operation.operation)) {
        expect(ERROR_CODES).toContain(code);
      }
    }
  });

  it('names the exact codes each order operation can emit (FR-034)', () => {
    expect(advertisedErrorCodes(operationBy('createOrder'))).toEqual([
      'CUSTOMER_NOT_FOUND',
      'IDEMPOTENCY_KEY_REUSED',
      'INVALID_IDEMPOTENCY_KEY',
      'ORDER_TOTAL_NOT_REPRESENTABLE',
      'PRODUCT_NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
    expect(advertisedErrorCodes(operationBy('getOrder'))).toEqual([
      'ORDER_NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
    expect(advertisedErrorCodes(operationBy('listOrders'))).toEqual([
      'INVALID_CURSOR',
      'VALIDATION_FAILED',
    ]);
    expect(advertisedErrorCodes(operationBy('cancelOrder'))).toEqual([
      'ORDER_NOT_FOUND',
      'TRANSITION_NOT_PERMITTED',
      'VALIDATION_FAILED',
    ]);
  });

  it('keeps INTERNAL_ERROR out of every operation, since no caller can provoke it', () => {
    for (const operation of documentedOperations(harness.document)) {
      expect(advertisedErrorCodes(operation.operation)).not.toContain('INTERNAL_ERROR');
    }
  });

  it('documents the closed status set for the order API and admits 503 only for health', () => {
    for (const operation of documentedOperations(harness.document)) {
      const statuses = statusesOf(operation.operation);
      const permitted = operation.path === '/health' ? [200, 503] : [200, 201, 400, 404, 409, 500];
      for (const status of statuses) {
        expect(permitted).toContain(status);
      }
    }

    expect(statusesOf(operationBy('checkHealth'))).toEqual([200, 503]);
  });

  it('refers every failure body to the shared error component rather than copying it', () => {
    for (const operation of documentedOperations(harness.document)) {
      if (operation.path === '/health') continue;
      const responses = operation.operation.responses as Record<string, JsonRecord>;
      for (const [status, response] of Object.entries(responses)) {
        if (Number(status) < 400) continue;
        const content = response.content as Record<string, JsonRecord>;
        const schema = content['application/json']?.schema as JsonRecord;
        expect(schema.$ref).toBe('#/components/schemas/ErrorBody');
      }
    }
  });

  it('describes what produces each documented status', () => {
    for (const operation of documentedOperations(harness.document)) {
      const responses = operation.operation.responses as Record<string, JsonRecord>;
      for (const response of Object.values(responses)) {
        expect(String(response.description ?? '').length).toBeGreaterThan(10);
      }
    }
  });

  it('records that the code is the stable part of an error and the message is not', () => {
    const schemas = harness.document.components?.schemas as JsonRecord;
    const errorBody = schemas.ErrorBody as JsonRecord;
    const properties = errorBody.properties as JsonRecord;

    expect(String((properties.code as JsonRecord).description)).toMatch(/machine-readable/i);
    expect(String((properties.message as JsonRecord).description)).toMatch(
      /never contains a stack trace/i,
    );
    // This assertion previously required the phrase "empty array otherwise",
    // which locked in a claim the service does not honour: five codes carry
    // detail, not one. It now requires the description to account for each code
    // by name, so a wrong summary cannot satisfy it the way a vague one did.
    const details = String((properties.details as JsonRecord).description);
    for (const code of ERROR_CODES) {
      if (code === 'INTERNAL_ERROR') continue;
      expect(`${code} accounted for: ${details.includes(code)}`).toBe(
        `${code} accounted for: true`,
      );
    }
  });
});
