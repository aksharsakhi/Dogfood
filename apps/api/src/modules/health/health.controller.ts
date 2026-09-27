import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from './health.service';
class HealthDto {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ enum: ['api'] }) service!: 'api';
}
class ReadyDto {
  @ApiProperty({ enum: ['ready'] }) status!: 'ready';
  @ApiProperty({ enum: ['connected'] }) database!: 'connected';
}
@ApiTags('Operations')
@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly service: HealthService) {}
  @Get('health')
  @ApiOkResponse({ type: HealthDto })
  health() {
    return this.service.health();
  }
  @Get('ready')
  @ApiOkResponse({ type: ReadyDto })
  @ApiServiceUnavailableResponse({ description: 'PostgreSQL is unavailable' })
  ready() {
    return this.service.ready();
  }
}
