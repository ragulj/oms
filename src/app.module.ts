import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/config.schema';
import type { Connection } from './database/client';
import { StructuredLogger } from './logging/logger';
import { HealthModule } from './health/health.module';
import { OrdersModule } from './orders/orders.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { CONFIG, CONNECTION, LOGGER } from './tokens';

export interface AppDependencies {
  config: AppConfig;
  connection: Connection;
  logger: StructuredLogger;
}

/**
 * Configuration, the database connection, and the logger are all resolved in
 * main.ts before Nest starts, because FR-007 and FR-015 require the process to
 * exit on a bad setting or a pending migration before anything is served.
 * They are injected here rather than constructed here for that reason.
 */
@Global()
@Module({})
export class AppModule {
  static register(deps: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule, OrdersModule, SchedulerModule],
      providers: [
        { provide: CONFIG, useValue: deps.config },
        { provide: CONNECTION, useValue: deps.connection },
        { provide: LOGGER, useValue: deps.logger },
      ],
      exports: [CONFIG, CONNECTION, LOGGER],
    };
  }
}
