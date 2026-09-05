import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../http/http-exception.filter';
import type { HttpRequestLike, HttpResponseLike } from '../http/http-types';
import { correlationIdOf } from '../http/correlation';
import { PositiveIntPipe } from '../http/positive-int.pipe';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  createOrderSchema,
  listOrdersSchema,
  type CreateOrderRequest,
  type ListOrdersQuery,
} from './order.schemas';
import { OrdersService } from './orders.service';
import type { OrderView } from './order.view';
import type { ListOrdersResult } from './orders.service';

export const IDEMPOTENT_REPLAY_HEADER = 'Idempotent-Replay';

/**
 * contracts/http-api.md. Four routes and no fifth: there is deliberately no path
 * that accepts an arbitrary target status (FR-064), and no update or delete of a
 * stored order, because Constitution Principle IV makes one permanent and
 * cancellation is the lifecycle's answer to an unwanted order.
 */
@Controller('orders')
@UseFilters(HttpExceptionFilter)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: HttpRequestLike,
    @Res({ passthrough: true }) response: HttpResponseLike,
  ): OrderView {
    const result = this.orders.create(body, {
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      correlationId: correlationIdOf(request),
    });

    // FR-032: a replay is 200 and carries a marker, so a caller can tell it from
    // the original creation without comparing bodies.
    if (result.replayed) {
      response.status(HttpStatus.OK).setHeader(IDEMPOTENT_REPLAY_HEADER, 'true');
    } else {
      response
        .status(HttpStatus.CREATED)
        .setHeader('Location', `/api/v1/orders/${result.order.id}`);
    }

    return result.order;
  }

  @Get()
  list(@Query(new ZodValidationPipe(listOrdersSchema)) query: ListOrdersQuery): ListOrdersResult {
    return this.orders.list(query);
  }

  @Get(':id')
  get(@Param('id', PositiveIntPipe) id: number): OrderView {
    return this.orders.get(id);
  }

  /** Takes no request body. The only transition a caller can ask for. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', PositiveIntPipe) id: number, @Req() request: HttpRequestLike): OrderView {
    return this.orders.cancel(id, correlationIdOf(request));
  }
}
