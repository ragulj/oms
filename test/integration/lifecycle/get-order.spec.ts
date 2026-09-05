import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/** User Story 2, and FR-038 to FR-043. */
describe('retrieving an order', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('returns the order, its lines, and its derived total', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(
      orderBody(catalog, [
        { productId: catalog.productId, quantity: 3 },
        { productId: catalog.otherProductId, quantity: 7 },
      ]),
    );

    const response = await api(harness).get(created.body.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
    expect(response.body.lines).toHaveLength(2);
    expect(response.body.totalMinor).toBe(
      response.body.lines.reduce(
        (sum: number, line: { lineTotalMinor: number }) => sum + line.lineTotalMinor,
        0,
      ),
    );
  });

  /** FR-041: the same order on every read, so a client can diff two responses. */
  it('returns line items in a stable ascending order', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(
      orderBody(
        catalog,
        Array.from({ length: 8 }, (_, i) => ({
          productId: i % 2 === 0 ? catalog.productId : catalog.otherProductId,
          quantity: i + 1,
        })),
      ),
    );

    const first = await api(harness).get(created.body.id);
    const second = await api(harness).get(created.body.id);

    const ids = first.body.lines.map((line: { id: number }) => line.id);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => a - b));
    expect(second.body.lines).toEqual(first.body.lines);
  });

  /** FR-043: follows from creation being atomic, not from a defensive check. */
  it('never returns an order with no lines', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(orderBody(catalog));

    const response = await api(harness).get(created.body.id);

    expect(response.body.lines.length).toBeGreaterThan(0);
  });

  it('reports an unknown identifier as not found', async () => {
    harness.catalog();
    const response = await api(harness).get(987_654);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ORDER_NOT_FOUND');
  });

  /**
   * FR-039. A malformed identifier is a bad request, not a missing resource.
   * Reporting 404 would tell a caller with a typo that the order does not exist,
   * which is a different and wrong statement.
   */
  it.each([
    ['non-numeric', 'abc'],
    ['negative', '-1'],
    ['zero', '0'],
    ['fractional', '1.5'],
    ['empty-ish', '%20'],
  ])('rejects a %s identifier as malformed rather than missing', async (_name, id) => {
    harness.catalog();
    const response = await api(harness).get(id);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  /**
   * FR-009. There is deliberately no formatted or millisecond-resolution
   * rendering of an ordering timestamp, because that is the value a client would
   * reach for when building its own cursor, and it is truncated.
   */
  it('exposes timestamps only as microsecond integers', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(orderBody(catalog));

    const response = await api(harness).get(created.body.id);
    const serialised = JSON.stringify(response.body);

    expect(Number.isSafeInteger(response.body.createdAtUs)).toBe(true);
    expect(Number.isSafeInteger(response.body.updatedAtUs)).toBe(true);
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(response.body).filter((key) => /At$|Date$|Iso$/i.test(key))).toEqual([]);
  });
});
