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
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
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
  preview(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: unknown,
  ) {
    if (!body || typeof body !== 'object' || !('archive' in body))
      fail(400, 'ARCHIVE_INVALID', 'An archive is required.');
    return this.archive.preview(principal, body.archive);
  }

  @Post('archives/confirm')
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
