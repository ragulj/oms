import { Inject, Injectable } from '@nestjs/common';
import type { Connection } from '../database/client';
import { CONNECTION } from '../tokens';

export type DependencyStatus = 'healthy' | 'unhealthy';

export interface HealthReport {
  status: DependencyStatus;
  dependencies: Record<string, DependencyStatus>;
}

@Injectable()
export class HealthService {
  constructor(@Inject(CONNECTION) private readonly connection: Connection) {}

  check(): HealthReport {
    let database: DependencyStatus = 'healthy';
    try {
      this.connection.sqlite.prepare('SELECT 1').get();
    } catch {
      database = 'unhealthy';
    }

    const dependencies = { database };
    const allHealthy = Object.values(dependencies).every((status) => status === 'healthy');
    return { status: allHealthy ? 'healthy' : 'unhealthy', dependencies };
  }
}
