import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService, type HealthReport } from './health.service';

/**
 * FR-030, contracts/health.md: a single endpoint on a stable unversioned path.
 * Success only when the service and every dependency are healthy; otherwise a
 * failure status whose body names the failing dependency. There is deliberately
 * no liveness/readiness split, since the declared scope has no orchestrator.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthReport {
    const report = this.health.check();
    if (report.status !== 'healthy') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
