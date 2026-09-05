import { Module } from '@nestjs/common';
import { HttpExceptionFilter } from '../http/http-exception.filter';
import { IdempotencyService } from './idempotency.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * The error envelope in contracts/http-api.md is the order API's contract, not
 * the whole process's. It is bound to this controller rather than registered
 * globally, so the health endpoint keeps the response shape Spec 001 defined for
 * it and this feature does not silently rewrite another feature's contract.
 */
@Module({
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyService, HttpExceptionFilter],
  exports: [OrdersService],
})
export class OrdersModule {}
