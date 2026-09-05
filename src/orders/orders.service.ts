import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Connection } from '../database/client';
import {
  customers,
  idempotencyRecords,
  orderLineItems,
  orders,
  products,
  type OrderStatus,
} from '../database/schema';
import { ApiError } from '../http/api-error';
import type { StructuredLogger } from '../logging/logger';
import { CONNECTION, LOGGER } from '../tokens';
import { IdempotencyService } from './idempotency.service';
import { decodeCursor, encodeCursor } from './order-cursor';
import { LINE_COLUMNS, ORDER_COLUMNS, orderLinesQuery, orderPageQuery } from './order-queries';
import { OrderTotalNotRepresentableError, deriveOrderTotalMinor } from './order-total';
import { applyTransition } from './order-transitions';
import {
  groupLinesByOrder,
  requireLineTotal,
  toLineRows,
  toOrderView,
  type LineRow,
  type OrderRow,
  type OrderView,
} from './order.view';
import type { CreateOrderRequest, ListOrdersQuery } from './order.schemas';

export interface CreateOrderOptions {
  idempotencyKey?: string;
  correlationId: string;
}

export interface CreateOrderResult {
  order: OrderView;
  replayed: boolean;
}

export interface ListOrdersResult {
  orders: OrderView[];
  nextCursor: string | null;
  limit: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(CONNECTION) private readonly connection: Connection,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * FR-011 to FR-034. Discharges Spec 002 contract obligation O1: the order and
   * every line are written in one transaction, so no reader can observe an order
   * with no lines.
   */
  create(request: CreateOrderRequest, options: CreateOrderOptions): CreateOrderResult {
    const { idempotencyKey, correlationId } = options;
    let fingerprint: string | undefined;

    if (idempotencyKey !== undefined) {
      this.idempotency.assertKeyWellFormed(idempotencyKey);
      fingerprint = this.idempotency.fingerprint(request);

      // A fast path, not the guarantee. The common repeat is a client retry
      // rather than a race, and a read is cheaper than an attempted transaction.
      // A request that passes here and then loses the race still fails on the
      // unique constraint below, which is what FR-034 actually requires.
      const existing = this.idempotency.find(this.connection, idempotencyKey);
      if (existing) {
        this.idempotency.assertFingerprintMatches(existing, fingerprint);
        return { order: this.get(existing.orderId), replayed: true };
      }
    }

    let orderId: number;
    try {
      orderId = this.insertOrder(request, idempotencyKey, fingerprint);
    } catch (error) {
      if (error instanceof OrderTotalNotRepresentableError) {
        throw error.toApiError();
      }
      // FR-034: the race, settled by the constraint. Another request created the
      // order under this key between the read above and this write.
      if (
        idempotencyKey !== undefined &&
        fingerprint !== undefined &&
        this.idempotency.isDuplicateKeyError(error)
      ) {
        const winner = this.idempotency.find(this.connection, idempotencyKey);
        if (winner) {
          this.idempotency.assertFingerprintMatches(winner, fingerprint);
          return { order: this.get(winner.orderId), replayed: true };
        }
      }
      throw error;
    }

    const order = this.get(orderId);

    // FR-095
    this.logger.emit('info', 'order.created', {
      correlationId,
      orderId,
      lineCount: order.lines.length,
      totalMinor: order.totalMinor,
    });

    return { order, replayed: false };
  }

  /** FR-038 to FR-043. One order query, one line query, total derived on read. */
  get(orderId: number): OrderView {
    const [order] = this.connection.db
      .select(ORDER_COLUMNS)
      .from(orders)
      .where(eq(orders.id, orderId))
      .all();

    if (!order) {
      throw ApiError.notFound('ORDER_NOT_FOUND', `No order exists with identifier ${orderId}.`);
    }

    const lines = this.connection.db
      .select(LINE_COLUMNS)
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId))
      .all();

    return this.view(order, toLineRows(lines));
  }

  /**
   * Constitution Principle V, and FR-044 to FR-057. Two queries: the page of
   * order identifiers, then the lines belonging to exactly those identifiers.
   * Never a join followed by a limit, which would materialise the full cartesian
   * product and paginate in memory.
   */
  list(query: ListOrdersQuery): ListOrdersResult {
    // One extra row, so the final page reports no continuation rather than
    // handing back a cursor onto nothing.
    const page = orderPageQuery(this.connection.db, {
      limit: query.limit + 1,
      ...(query.cursor ? { cursor: decodeCursor(query.cursor) } : {}),
      ...(query.status ? { status: query.status } : {}),
    }).all();

    const hasMore = page.length > query.limit;
    const rows = hasMore ? page.slice(0, query.limit) : page;

    if (rows.length === 0) {
      return { orders: [], nextCursor: null, limit: query.limit };
    }

    const lines = orderLinesQuery(
      this.connection.db,
      rows.map((row) => row.id),
    ).all();

    const grouped = groupLinesByOrder(toLineRows(lines));
    const last = rows[rows.length - 1]!;

    return {
      orders: rows.map((row) => this.view(row, grouped.get(row.id) ?? [])),
      nextCursor: hasMore ? encodeCursor({ createdAtUs: last.createdAtUs, id: last.id }) : null,
      limit: query.limit,
    };
  }

  /**
   * FR-072 to FR-079. The transition itself lives in `order-transitions.ts`;
   * this only turns its outcome into an HTTP answer.
   */
  cancel(orderId: number, correlationId: string): OrderView {
    const target: OrderStatus = 'cancelled';
    const result = applyTransition(this.connection, this.logger, orderId, target, {
      correlationId,
      actor: 'request',
    });

    if (result.outcome === 'missing') {
      throw ApiError.notFound('ORDER_NOT_FOUND', `No order exists with identifier ${orderId}.`);
    }
    if (result.outcome === 'conflict') {
      throw ApiError.conflict(
        'TRANSITION_NOT_PERMITTED',
        `An order with status "${result.currentStatus}" cannot move to "${target}".`,
      );
    }

    return this.get(orderId);
  }

  /**
   * FR-042a: the exactness check applies on read as well as on write. An order
   * whose total cannot be stated exactly fails loudly rather than coming back
   * rounded, on every path that derives one.
   */
  private view(order: OrderRow, lines: readonly LineRow[]): OrderView {
    try {
      return toOrderView(order, lines);
    } catch (error) {
      if (error instanceof OrderTotalNotRepresentableError) {
        throw error.toApiError();
      }
      throw error;
    }
  }

  private insertOrder(
    request: CreateOrderRequest,
    idempotencyKey: string | undefined,
    fingerprint: string | undefined,
  ): number {
    const catalog = this.resolveCatalog(request);
    const nowUs = Date.now() * 1000;

    return this.connection.db.transaction((tx) => {
      const [created] = tx
        .insert(orders)
        .values({ customerId: request.customerId, createdAtUs: nowUs, updatedAtUs: nowUs })
        .returning({ id: orders.id })
        .all();

      const orderId = created!.id;

      // FR-018, FR-019: description and price come from the catalog, never from
      // the request. `lineTotalMinor` is absent because Spec 002 made it a stored
      // generated column, so it is unrepresentable as a write.
      tx.insert(orderLineItems)
        .values(
          request.lines.map((line) => {
            const product = catalog.get(line.productId)!;
            return {
              orderId,
              productId: line.productId,
              productDescription: product.name,
              unitPriceMinor: product.unitPriceMinor,
              quantity: line.quantity,
            };
          }),
        )
        .run();

      // FR-024, FR-025: derived from what the database computed, inside the
      // transaction, so an order whose total is inexact is never stored. Reading
      // the totals back also proves the generated column did what we think.
      const stored = tx
        .select({ id: orderLineItems.id, lineTotalMinor: orderLineItems.lineTotalMinor })
        .from(orderLineItems)
        .where(eq(orderLineItems.orderId, orderId))
        .all();
      deriveOrderTotalMinor(stored.map((row) => requireLineTotal(row.lineTotalMinor, row.id)));

      // FR-031: recorded in the same transaction, so a key is never recorded for
      // an order that was not created.
      if (idempotencyKey !== undefined && fingerprint !== undefined) {
        tx.insert(idempotencyRecords)
          .values({ idempotencyKey, requestFingerprint: fingerprint, orderId, createdAtUs: nowUs })
          .run();
      }

      return orderId;
    });
  }

  /**
   * FR-016, FR-017. Resolved before the transaction opens, so a request naming a
   * missing customer or product writes nothing at all, not even the order row.
   */
  private resolveCatalog(
    request: CreateOrderRequest,
  ): Map<number, { name: string; unitPriceMinor: number }> {
    const [customer] = this.connection.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, request.customerId))
      .all();

    if (!customer) {
      throw ApiError.badRequest(
        'CUSTOMER_NOT_FOUND',
        'The order names a customer that does not exist.',
        [{ field: 'customerId', message: `No customer with identifier ${request.customerId}.` }],
      );
    }

    const requested = [...new Set(request.lines.map((line) => line.productId))];
    const found = this.connection.db
      .select({ id: products.id, name: products.name, unitPriceMinor: products.unitPriceMinor })
      .from(products)
      .where(inArray(products.id, requested))
      .orderBy(asc(products.id))
      .all();

    const catalog = new Map(found.map((row) => [row.id, row]));
    const missing = requested.filter((id) => !catalog.has(id));
    if (missing.length > 0) {
      throw ApiError.badRequest(
        'PRODUCT_NOT_FOUND',
        'The order names one or more products that do not exist.',
        missing.map((id) => ({
          field: 'lines.productId',
          message: `No product with identifier ${id}.`,
        })),
      );
    }

    return catalog;
  }
}
