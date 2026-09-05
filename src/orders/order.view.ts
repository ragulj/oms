import type { OrderStatus } from '../database/schema';
import { deriveOrderTotalMinor } from './order-total';

export interface OrderRow {
  id: number;
  customerId: number;
  status: OrderStatus;
  createdAtUs: number;
  updatedAtUs: number;
}

export interface LineRow {
  id: number;
  orderId: number;
  productId: number;
  productDescription: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

/** What the driver hands back: Drizzle types a generated column as nullable. */
export type RawLineRow = Omit<LineRow, 'lineTotalMinor'> & { lineTotalMinor: number | null };

/**
 * A null line total is impossible, since Spec 002 computes it from two NOT NULL
 * columns. It is narrowed by throwing rather than by defaulting to zero: a zero
 * would silently understate an order total, which is exactly the class of
 * failure Constitution Principle IV exists to prevent.
 */
export function requireLineTotal(lineTotalMinor: number | null, lineId: number): number {
  if (lineTotalMinor === null) {
    throw new Error(`Line item ${lineId} has no computed line total.`);
  }
  return lineTotalMinor;
}

export function toLineRows(rows: readonly RawLineRow[]): LineRow[] {
  return rows.map((row) => ({
    ...row,
    lineTotalMinor: requireLineTotal(row.lineTotalMinor, row.id),
  }));
}

export interface LineView {
  id: number;
  productId: number;
  productDescription: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface OrderView {
  id: number;
  customerId: number;
  status: OrderStatus;
  createdAtUs: number;
  updatedAtUs: number;
  totalMinor: number;
  lines: LineView[];
}

/**
 * FR-009 and FR-010. Microsecond integers only: there is deliberately no
 * formatted or millisecond-resolution rendering of an ordering timestamp
 * anywhere in a response, because that is the value a client would reach for
 * when building its own cursor, and Constitution Principle V exists because it
 * is truncated. Removing the field removes the mistake.
 */
export function toOrderView(order: OrderRow, lines: readonly LineRow[]): OrderView {
  const ordered = [...lines].sort((a, b) => a.id - b.id);
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    createdAtUs: order.createdAtUs,
    updatedAtUs: order.updatedAtUs,
    totalMinor: deriveOrderTotalMinor(ordered.map((line) => line.lineTotalMinor)),
    lines: ordered.map((line) => ({
      id: line.id,
      productId: line.productId,
      productDescription: line.productDescription,
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
    })),
  };
}

/** Groups a flat line-item result set by order, for the second phase of a paged read. */
export function groupLinesByOrder(lines: readonly LineRow[]): Map<number, LineRow[]> {
  const grouped = new Map<number, LineRow[]>();
  for (const line of lines) {
    const existing = grouped.get(line.orderId);
    if (existing) {
      existing.push(line);
    } else {
      grouped.set(line.orderId, [line]);
    }
  }
  return grouped;
}
