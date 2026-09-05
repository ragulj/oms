import {
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';
import {
  DEFAULT_PAGE_SIZE,
  MAX_LINES_PER_ORDER,
  MAX_PAGE_SIZE,
  MAX_QUANTITY,
} from '../../../src/orders/order.schemas';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from '../../../src/database/schema/idempotency-records';

/**
 * FR-010, FR-015, FR-016, FR-079, SC-006. The documented bounds are the enforced
 * bounds, because they are the same values: the request schemas are converted
 * from the schemas that validate, not written beside them.
 *
 * These assertions would be circular if the document restated its bounds as
 * literals. They are not, because the constants imported here are the ones the
 * pipe uses to reject a request, and changing one changes both sides at once,
 * which is what SC-006 measures by mutation.
 */
describe('request schemas are derived from what actually validates', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const createRequest = (): JsonRecord =>
    (harness.document.components?.schemas as JsonRecord).CreateOrderRequest as JsonRecord;

  const listParameters = (): JsonRecord[] => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'listOrders',
    );
    return (operation?.operation.parameters ?? []) as JsonRecord[];
  };

  it('documents exactly the two permitted top-level properties (FR-014)', () => {
    expect(Object.keys(createRequest().properties as JsonRecord).sort()).toEqual([
      'customerId',
      'lines',
    ]);
    expect((createRequest().required as string[]).sort()).toEqual(['customerId', 'lines']);
  });

  it('documents exactly the two permitted line properties (FR-014)', () => {
    const lines = (createRequest().properties as JsonRecord).lines as JsonRecord;
    const item = lines.items as JsonRecord;
    expect(Object.keys(item.properties as JsonRecord).sort()).toEqual(['productId', 'quantity']);
  });

  it('rejects unknown properties, and says so, at every level (FR-015)', () => {
    expect(createRequest().additionalProperties).toBe(false);
    const lines = (createRequest().properties as JsonRecord).lines as JsonRecord;
    expect((lines.items as JsonRecord).additionalProperties).toBe(false);
  });

  it('documents no price, total, status, identifier or timestamp on a request', () => {
    const properties = Object.keys(createRequest().properties as JsonRecord);
    const lines = (createRequest().properties as JsonRecord).lines as JsonRecord;
    const lineProperties = Object.keys((lines.items as JsonRecord).properties as JsonRecord);

    for (const forbidden of ['unitPriceMinor', 'lineTotalMinor', 'totalMinor', 'status', 'id']) {
      expect(properties).not.toContain(forbidden);
      expect(lineProperties).not.toContain(forbidden);
    }
  });

  it('documents the line-count bounds the service enforces (FR-016)', () => {
    const lines = (createRequest().properties as JsonRecord).lines as JsonRecord;
    expect(lines.minItems).toBe(1);
    expect(lines.maxItems).toBe(MAX_LINES_PER_ORDER);
  });

  it('documents the quantity bounds the service enforces (FR-016)', () => {
    const lines = (createRequest().properties as JsonRecord).lines as JsonRecord;
    const quantity = ((lines.items as JsonRecord).properties as JsonRecord).quantity as JsonRecord;
    expect(quantity.type).toBe('integer');
    expect(quantity.minimum).toBe(1);
    expect(quantity.maximum).toBe(MAX_QUANTITY);
  });

  it('documents the page-size default and maximum the service enforces (FR-016, FR-018)', () => {
    const limit = listParameters().find((parameter) => parameter.name === 'limit');
    const schema = limit?.schema as JsonRecord;
    expect(schema.type).toBe('integer');
    expect(schema.default).toBe(DEFAULT_PAGE_SIZE);
    expect(schema.minimum).toBe(1);
    expect(schema.maximum).toBe(MAX_PAGE_SIZE);
    expect(limit?.required).not.toBe(true);
  });

  it('records that an out-of-range page size is rejected rather than clamped (FR-018)', () => {
    const limit = listParameters().find((parameter) => parameter.name === 'limit');
    expect(String(limit?.description)).toMatch(/rejected, never clamped/i);
  });

  it('documents the three listing parameters and no others (FR-019)', () => {
    expect(listParameters().map((parameter) => parameter.name).sort()).toEqual([
      'cursor',
      'limit',
      'status',
    ]);
  });

  it('records that offset-style paging is rejected rather than ignored (FR-019)', () => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'listOrders',
    );
    expect(String(operation?.operation.description)).toMatch(/no `offset` or `page` parameter/i);
    expect(String(operation?.operation.description)).toMatch(/rejected rather than ignored/i);
  });

  it('documents the status filter as the three known statuses', () => {
    const status = listParameters().find((parameter) => parameter.name === 'status');
    expect((status?.schema as JsonRecord).enum).toEqual(['pending', 'processing', 'cancelled']);
  });

  it('documents the path parameter as a positive integer, and why it is 400 (FR-020)', () => {
    for (const operationId of ['getOrder', 'cancelOrder']) {
      const operation = documentedOperations(harness.document).find(
        (candidate) => candidate.operationId === operationId,
      );
      const parameters = (operation?.operation.parameters ?? []) as JsonRecord[];
      const id = parameters.find((parameter) => parameter.name === 'id');
      expect((id?.schema as JsonRecord).type).toBe('integer');
      expect((id?.schema as JsonRecord).minimum).toBe(1);
    }

    const get = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'getOrder',
    );
    const responses = get?.operation.responses as Record<string, JsonRecord>;
    expect(String(responses['400']?.description)).toMatch(/malformed request rather than a missing/i);
  });

  it('documents the idempotency key bounds the service enforces (FR-041)', () => {
    const create = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'createOrder',
    );
    const parameters = (create?.operation.parameters ?? []) as JsonRecord[];
    const header = parameters.find((parameter) => parameter.name === 'Idempotency-Key');

    expect(header?.required).not.toBe(true);
    expect((header?.schema as JsonRecord).minLength).toBe(IDEMPOTENCY_KEY_MIN_LENGTH);
    expect((header?.schema as JsonRecord).maxLength).toBe(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(String(header?.description)).toMatch(/no replay protection/i);
  });

  it('records that the cancel operation takes no request body (FR-021)', () => {
    const cancel = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'cancelOrder',
    );
    expect(cancel?.operation.requestBody).toBeUndefined();
    expect(String(cancel?.operation.description)).toMatch(/takes no request body/i);
  });
});
