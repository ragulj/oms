import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService, type HealthReport } from './health.service';
import { ApiHealthCheck } from '../docs/health-api.decorators';

/**
 * FR-030, contracts/health.md: a single endpoint on a stable unversioned path.
 * Success only when the service and every dependency are healthy; otherwise a
 * failure status whose body names the failing dependency. There is deliberately
 * no liveness/readiness split, since the declared scope has no orchestrator.
 */
@Controller('health')
@ApiTags('Operations')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiHealthCheck()
  check(): HealthReport {
    const report = this.health.check();
    if (report.status !== 'healthy') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
