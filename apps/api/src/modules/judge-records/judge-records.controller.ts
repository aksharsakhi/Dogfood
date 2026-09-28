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
import { IssueJudgeRecordDto } from './judge-records.dto';
import { JudgeRecordsService } from './judge-records.service';

@ApiTags('Judge record verification')
@Controller('judge-records')
export class PublicJudgeRecordsController {
  constructor(
    @Inject(JudgeRecordsService) private readonly records: JudgeRecordsService,
  ) {}

  @Get('keys')
  keys() {
    return this.records.publicKeys();
  }

  @Get(':recordId/verify')
  verify(@Param('recordId', ParseUUIDPipe) recordId: string) {
    return this.records.verify(recordId);
  }
}

@ApiTags('Certificates and judge participation records')
@Controller('events/:eventId')
export class EventRecordsController {
  constructor(
    @Inject(JudgeRecordsService) private readonly records: JudgeRecordsService,
  ) {}

  @Get('certificates/registration/me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async ownRegistration(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.records.registrationHtml(
      principal,
      eventId,
      principal.userId,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(html);
  }

  @Get('certificates/registration/:userId')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async registrationForAccount(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.records.registrationHtml(
      principal,
      eventId,
      userId,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(html);
  }

  @Get('certificates/projects/me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async ownProjectParticipation(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.records.ownProjectParticipationHtml(
      principal,
      eventId,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(html);
  }

  @Get('certificates/projects/:projectId/participants/:userId')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async projectParticipationForAccount(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.records.projectParticipantHtml(
      principal,
      eventId,
      projectId,
      userId,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(html);
  }

  @Get('judge-records')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  list(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.records.listForOrganizer(principal, eventId);
  }

  @Get('judge-records/me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  ownRecords(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.records.ownRecords(principal, eventId);
  }

  @Post('judge-records/:judgeProfileId')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  issue(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('judgeProfileId', ParseUUIDPipe) judgeProfileId: string,
    @Body() dto: IssueJudgeRecordDto,
  ) {
    return this.records.issue(
      principal,
      eventId,
      judgeProfileId,
      dto.supersedesRecordId,
    );
  }

  @Post('judge-records/:recordId/revoke')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  revoke(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ) {
    return this.records.revoke(principal, eventId, recordId);
  }

  @Get('judge-records/:recordId/certificate')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  async certificate(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.records.judgeRecordHtml(
      principal,
      eventId,
      recordId,
    );
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      .send(html);
  }
}
