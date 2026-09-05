import { encodeCursor } from '../../../src/orders/order-cursor';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

/** User Story 3, and FR-046, FR-047, FR-050, FR-056, FR-056a. */
describe('rejecting an invalid listing request', () => {
  let harness: LifecycleHarness;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** FR-046: rejected rather than clamped, so a caller never believes it got more than it did. */
  it.each([
    ['zero', '?limit=0'],
    ['negative', '?limit=-1'],
    ['above the maximum', '?limit=101'],
    ['fractional', '?limit=10.5'],
    ['non-numeric', '?limit=all'],
  ])('rejects a limit that is %s', async (_name, query) => {
    harness.catalog();
    const response = await api(harness).list(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['the minimum', '?limit=1', 1],
    ['the maximum', '?limit=100', 100],
  ])('accepts a limit at %s', async (_name, query, expected) => {
    harness.catalog();
    const response = await api(harness).list(query);

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(expected);
  });

  it('defaults the limit to 50', async () => {
    harness.catalog();
    const response = await api(harness).list();

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(50);
  });

  /**
   * FR-047. Not merely unsupported: accepting an offset while ignoring it would
   * let a caller believe it was paging when it was re-reading page one.
   */
  it.each([
    ['offset', '?offset=10'],
    ['page', '?page=2'],
    ['skip', '?skip=5'],
    ['sort', '?sort=createdAt'],
  ])('rejects the unsupported %s parameter', async (_name, query) => {
    harness.catalog();
    const response = await api(harness).list(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  /**
   * FR-056a. Spec 002 left `orders.customer_id` deliberately unindexed under its
   * FR-039a, so a customer filter would scan the table behind an index-shaped
   * API. It is refused, and this is what keeps the refusal from being quietly
   * reversed.
   */
  it('rejects a customer filter rather than scanning for it', async () => {
    const catalog = harness.catalog();
    await api(harness).create(orderBody(catalog));

    const response = await api(harness).list(`?customerId=${catalog.customerId}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['unknown', '?status=shipped'],
    ['empty', '?status='],
    ['wrong case', '?status=PENDING'],
  ])('rejects a status filter that is %s', async (_name, query) => {
    harness.catalog();
    const response = await api(harness).list(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it.each(['pending', 'processing', 'cancelled'])(
    'accepts the %s status filter',
    async (status) => {
      harness.catalog();
      const response = await api(harness).list(`?status=${status}`);

      expect(response.status).toBe(200);
    },
  );

  /** FR-050: rejected, never treated as an absent cursor. */
  it.each([
    ['not base64', '?cursor=%25%25%25'],
    ['structurally wrong', `?cursor=${Buffer.from('1700', 'utf8').toString('base64url')}`],
    ['non-numeric', `?cursor=${Buffer.from('a.b', 'utf8').toString('base64url')}`],
  ])('rejects a cursor that is %s', async (_name, query) => {
    harness.catalog();
    const response = await api(harness).list(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_CURSOR');
  });

  it('rejects a well-formed but unknown cursor with results rather than an error', async () => {
    const catalog = harness.catalog();
    await api(harness).create(orderBody(catalog));

    // A valid cursor positioned before every row: an empty page, not a failure.
    const response = await api(harness).list(`?cursor=${encodeCursor({ createdAtUs: 1, id: 1 })}`);

    expect(response.status).toBe(200);
    expect(response.body.orders).toEqual([]);
    expect(response.body.nextCursor).toBeNull();
  });
});
