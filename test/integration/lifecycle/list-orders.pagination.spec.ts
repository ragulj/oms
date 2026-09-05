import type { OrderStatus } from '../../../src/database/schema';
import { OrdersService } from '../../../src/orders/orders.service';
import { seedManyOrders } from '../../support/order-fixtures';
import {
  api,
  createLifecycleHarness,
  orderBody,
  type LifecycleHarness,
} from '../../support/http-fixtures';

interface PagedOrder {
  id: number;
  createdAtUs: number;
  status: OrderStatus;
}

/**
 * User Story 3, and FR-052, FR-053, FR-057, plus SC-002.
 *
 * The full traversals go through the service rather than over HTTP: at 10,000
 * orders the transport would dominate the runtime without testing anything the
 * transport does not already have its own tests for. The HTTP surface is
 * exercised here too, at a size where it is cheap.
 */
describe('paging the order list', () => {
  let harness: LifecycleHarness;
  let service: OrdersService;

  beforeAll(async () => {
    harness = await createLifecycleHarness();
    service = harness.app.get(OrdersService, { strict: false });
  });

  afterAll(async () => {
    await harness.close();
  });

  const traverse = (limit: number, status?: OrderStatus): PagedOrder[] => {
    const seen: PagedOrder[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = service.list({
        limit,
        ...(cursor ? { cursor } : {}),
        ...(status ? { status } : {}),
      });
      seen.push(...(page.orders as PagedOrder[]));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    return seen;
  };

  const storedIds = (status?: OrderStatus): number[] => {
    const sql = status
      ? 'SELECT id FROM orders WHERE status = ? ORDER BY id'
      : 'SELECT id FROM orders ORDER BY id';
    const rows = (
      status
        ? harness.connection.sqlite.prepare(sql).all(status)
        : harness.connection.sqlite.prepare(sql).all()
    ) as { id: number }[];
    return rows.map((row) => row.id);
  };

  /** SC-002. Three page sizes that divide 10,000 unevenly, so no boundary is accidental. */
  it.each([37, 50, 100])('returns every one of 10,000 orders exactly once at limit %i', (limit) => {
    const { orderCount } = seedManyOrders(harness.connection, 10_000);

    const seen = traverse(limit);
    const ids = seen.map((order) => order.id);

    expect(seen).toHaveLength(orderCount);
    expect(new Set(ids).size).toBe(orderCount);
    expect([...ids].sort((a, b) => a - b)).toEqual(storedIds());
  });

  /**
   * The failure Constitution Principle V names. Orders sharing a microsecond
   * either repeat across pages or vanish between them unless the cursor carries a
   * unique tiebreaker.
   */
  it('keeps a total order across rows sharing a creation timestamp', () => {
    const { sharedTimestampUs } = seedManyOrders(harness.connection, 2_000);

    const colliding = (
      harness.connection.sqlite
        .prepare('SELECT id FROM orders WHERE created_at_us = ? ORDER BY id DESC')
        .all(sharedTimestampUs) as { id: number }[]
    ).map((row) => row.id);

    expect(colliding.length).toBeGreaterThan(1);

    // A page size smaller than the collision run, so the run must straddle a
    // page boundary and the tiebreaker has to carry it.
    const seen = traverse(3).map((order) => order.id);
    const positions = colliding.map((id) => seen.indexOf(id));

    expect(positions).not.toContain(-1);
    expect(new Set(positions).size).toBe(colliding.length);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[positions.length - 1]! - positions[0]!).toBe(colliding.length - 1);
  });

  it('returns orders newest first', () => {
    seedManyOrders(harness.connection, 500);

    const seen = traverse(50);

    for (let i = 1; i < seen.length; i += 1) {
      const previous = seen[i - 1]!;
      const current = seen[i]!;
      const descending =
        previous.createdAtUs > current.createdAtUs ||
        (previous.createdAtUs === current.createdAtUs && previous.id > current.id);
      expect(descending).toBe(true);
    }
  });

  /** FR-056: the filter applies to the whole listing, and paging still holds. */
  it('pages a filtered listing completely', () => {
    seedManyOrders(harness.connection, 3_000);

    for (const status of ['pending', 'processing', 'cancelled'] as const) {
      const seen = traverse(13, status).map((order) => order.id);

      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort((a, b) => a - b)).toEqual(storedIds(status));
    }
  });

  /** FR-053 */
  it('returns the same page for the same cursor', () => {
    seedManyOrders(harness.connection, 300);

    const first = service.list({ limit: 20 });
    expect(first.nextCursor).not.toBeNull();

    const a = service.list({ limit: 20, cursor: first.nextCursor! });
    const b = service.list({ limit: 20, cursor: first.nextCursor! });

    expect(a).toEqual(b);
  });

  /**
   * FR-057. New orders are newer than the cursor, so they belong on pages the
   * traversal has already passed. They must not shift or duplicate what is left.
   */
  it('is unaffected by orders created mid-traversal', async () => {
    seedManyOrders(harness.connection, 200);
    const catalog = harness.catalog();

    const firstPage = service.list({ limit: 20 });
    const cursor = firstPage.nextCursor!;
    const expected = service.list({ limit: 20, cursor });

    await api(harness).create(orderBody(catalog));
    await api(harness).create(orderBody(catalog));

    expect(service.list({ limit: 20, cursor })).toEqual(expected);
  });

  /** FR-051, over HTTP, where the contract is what a caller actually sees. */
  it('reports no continuation on the final page', async () => {
    const catalog = harness.catalog();
    for (let i = 0; i < 5; i += 1) {
      await api(harness).create(orderBody(catalog));
    }

    const full = await api(harness).list('?limit=5');
    expect(full.status).toBe(200);
    expect(full.body.orders).toHaveLength(5);
    expect(full.body.nextCursor).toBeNull();

    const partial = await api(harness).list('?limit=2');
    expect(partial.body.nextCursor).not.toBeNull();
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    harness.catalog();

    const response = await api(harness).list('?status=cancelled');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orders: [], nextCursor: null, limit: 50 });
  });

  it('includes line items with each listed order', async () => {
    const catalog = harness.catalog();
    const created = await api(harness).create(
      orderBody(catalog, [
        { productId: catalog.productId, quantity: 2 },
        { productId: catalog.otherProductId, quantity: 4 },
      ]),
    );

    const response = await api(harness).list('?limit=10');

    expect(response.body.orders[0]).toEqual(created.body);
    expect(response.body.orders[0].lines).toHaveLength(2);
  });
});
