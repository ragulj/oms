import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderPromotionTask } from './order-promotion.task';
import { OverlapGuard } from './overlap-guard';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [OrderPromotionTask, OverlapGuard],
  exports: [OrderPromotionTask, OverlapGuard],
})
export class SchedulerModule {}
