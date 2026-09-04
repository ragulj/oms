import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HeartbeatTask } from './heartbeat.task';
import { OverlapGuard } from './overlap-guard';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [HeartbeatTask, OverlapGuard],
  exports: [HeartbeatTask, OverlapGuard],
})
export class SchedulerModule {}
