import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { fail } from '../../common/errors/domain-error';
import { EventArchiveService } from './archive.service';

@ApiTags('Event Archives')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events')
export class EventArchiveController {
  constructor(
    @Inject(EventArchiveService) private readonly archive: EventArchiveService,
  ) {}

  @Get(':eventId/archive')
  @ApiOperation({ summary: 'Export complete portable event archive package' })
  async export(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.archive.export(principal, eventId);
    reply.header(
      'Content-Disposition',
      `attachment; filename="dogfood-event-${eventId}.json"`,
    );
    return result;
  }

  @Post('archives/preview')
  @ApiOperation({
    summary: 'Preview portable event archive package before import',
  })
  @ApiBody({
    description: 'Archive JSON payload wrapped in archive property',
    schema: {
      type: 'object',
      required: ['archive'],
      properties: {
        archive: {
          type: 'object',
          description: 'Valid DogFood event archive package',
        },
      },
    },
  })
  preview(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: unknown,
  ) {
    if (!body || typeof body !== 'object' || !('archive' in body))
      fail(400, 'ARCHIVE_INVALID', 'An archive is required.');
    return this.archive.preview(principal, body.archive);
  }

  @Post('archives/confirm')
  @ApiOperation({
    summary: 'Confirm and execute portable event archive import',
  })
  @ApiBody({
    description:
      'Archive confirmation payload with matching preview packageHash',
    schema: {
      type: 'object',
      required: ['archive', 'packageHash'],
      properties: {
        archive: {
          type: 'object',
          description: 'Valid DogFood event archive package',
        },
        packageHash: {
          type: 'string',
          description: 'SHA-256 package hash verified during preview',
        },
      },
    },
  })
  confirm(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      !('archive' in body) ||
      !('packageHash' in body) ||
      typeof body.packageHash !== 'string'
    )
      fail(
        400,
        'ARCHIVE_INVALID',
        'Archive and previewed package hash are required.',
      );
    return this.archive.confirm(principal, body.archive, body.packageHash);
  }
}
