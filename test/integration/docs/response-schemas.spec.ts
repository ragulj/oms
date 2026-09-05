import {
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';

/**
 * FR-022, FR-025, FR-029. The order representation is described once and
 * referenced, derived values are marked so a reader does not try to send them,
 * and the guarantees a caller would otherwise have to discover are written down.
 */
describe('response schemas are shared, not repeated', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const schemas = (): JsonRecord => harness.document.components?.schemas as JsonRecord;

  const successSchemaRefs = (operationId: string): unknown[] => {
    const operation = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === operationId,
    );
    const responses = (operation?.operation.responses ?? {}) as Record<string, JsonRecord>;
    return Object.entries(responses)
      .filter(([status]) => Number(status) < 400)
      .map(([, response]) => {
        const content = response.content as Record<string, JsonRecord>;
        return (content['application/json']?.schema as JsonRecord)?.$ref;
      });
  };

  it('references the order representation rather than inlining it (FR-022)', () => {
    for (const operationId of ['createOrder', 'getOrder', 'cancelOrder']) {
      for (const ref of successSchemaRefs(operationId)) {
        expect(ref).toBe('#/components/schemas/OrderView');
      }
    }
  });

  it('references the order representation from inside the listing envelope too', () => {
    const listing = schemas().ListOrdersResponse as JsonRecord;
    const orders = (listing.properties as JsonRecord).orders as JsonRecord;
    expect((orders.items as JsonRecord).$ref).toBe('#/components/schemas/OrderView');
    expect(successSchemaRefs('listOrders')).toEqual(['#/components/schemas/ListOrdersResponse']);
  });

  it('references the line representation rather than inlining it', () => {
    const order = schemas().OrderView as JsonRecord;
    const lines = (order.properties as JsonRecord).lines as JsonRecord;
    expect((lines.items as JsonRecord).$ref).toBe('#/components/schemas/OrderLineView');
  });

  it('references the status enumeration rather than repeating its values', () => {
    const order = schemas().OrderView as JsonRecord;
    const status = (order.properties as JsonRecord).status as JsonRecord;
    expect(status.$ref).toBe('#/components/schemas/OrderStatus');
  });

  it('marks derived values read-only so a reader does not try to send them (FR-025)', () => {
    const order = schemas().OrderView as JsonRecord;
    const total = (order.properties as JsonRecord).totalMinor as JsonRecord;
    expect(total.readOnly).toBe(true);
    expect(String(total.description)).toMatch(/derived on read and never stored/i);

    const line = schemas().OrderLineView as JsonRecord;
    const lineTotal = (line.properties as JsonRecord).lineTotalMinor as JsonRecord;
    expect(lineTotal.readOnly).toBe(true);
    expect(String(lineTotal.description)).toMatch(/computed by the database/i);
  });

  it('records that the captured price is unaffected by later catalog changes', () => {
    const line = schemas().OrderLineView as JsonRecord;
    const price = (line.properties as JsonRecord).unitPriceMinor as JsonRecord;
    expect(String(price.description)).toMatch(/unaffected by later catalog changes/i);
  });

  it('records that an order never has an empty line list', () => {
    const order = schemas().OrderView as JsonRecord;
    const lines = (order.properties as JsonRecord).lines as JsonRecord;
    expect(lines.minItems).toBe(1);
    expect(String(lines.description)).toMatch(/never empty/i);
  });

  it('documents the listing envelope with its page, token and applied page size (FR-026)', () => {
    const listing = schemas().ListOrdersResponse as JsonRecord;
    expect(Object.keys(listing.properties as JsonRecord).sort()).toEqual([
      'limit',
      'nextCursor',
      'orders',
    ]);
  });

  it('records that the token is absent on the final page (FR-028)', () => {
    const listing = schemas().ListOrdersResponse as JsonRecord;
    const cursor = (listing.properties as JsonRecord).nextCursor as JsonRecord;
    expect(String(cursor.description)).toMatch(/null on the final page/i);
  });

  it('distinguishes a creation from a replay by status code and header (FR-045)', () => {
    const create = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'createOrder',
    );
    const responses = create?.operation.responses as Record<string, JsonRecord>;

    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['200', '201']));
    expect(String(responses['200']?.description)).toMatch(/replay/i);
    expect(Object.keys((responses['200']?.headers ?? {}) as JsonRecord)).toContain(
      'Idempotent-Replay',
    );
    expect(Object.keys((responses['201']?.headers ?? {}) as JsonRecord)).toContain('Location');
  });

  it('uses the health report for both health responses, not the error body', () => {
    const health = documentedOperations(harness.document).find(
      (candidate) => candidate.operationId === 'checkHealth',
    );
    const responses = health?.operation.responses as Record<string, JsonRecord>;
    for (const status of ['200', '503']) {
      const content = responses[status]?.content as Record<string, JsonRecord>;
      expect((content['application/json']?.schema as JsonRecord).$ref).toBe(
        '#/components/schemas/HealthReport',
      );
    }
  });
});
