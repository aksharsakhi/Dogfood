import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HealthResponse, ReadyResponse } from '@dogfood/contracts';
import { DatabaseService } from '../../infrastructure/database/database.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  health(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }
  async ready(): Promise<ReadyResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.database.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readiness timed out')),
            2000,
          );
        }),
      ]);
      return { status: 'ready', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
