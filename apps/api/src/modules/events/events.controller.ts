import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { AuthService } from '../identity/auth.service';
import {
  CreateEventDto,
  PrizeDto,
  TrackDto,
  UpdateEventDto,
  UpdatePrizeDto,
  UpdateTrackDto,
} from './event.dto';
import { EventsService } from './events.service';
@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get() async list(@Req() request: FastifyRequest) {
    return this.events.list(await this.auth.resolve(request));
  }
  @Get(':eventId') async detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.events.visible(eventId, await this.auth.resolve(request));
  }
  @Post() @UseGuards(SessionAuthGuard) @ApiCookieAuth() create(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: CreateEventDto,
  ) {
    return this.events.create(p, dto);
  }
  @Patch(':eventId') @UseGuards(SessionAuthGuard) @ApiCookieAuth() update(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.events.update(p, eventId, dto);
  }
  @Post(':eventId/publish')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  publish(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.publish(p, eventId);
  }
  @Get(':eventId/tracks') async tracks(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.events.tracks(eventId, await this.auth.resolve(request));
  }
  @Post(':eventId/tracks')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  createTrack(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: TrackDto,
  ) {
    return this.events.createTrack(p, eventId, dto);
  }
  @Patch(':eventId/tracks/:trackId')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  updateTrack(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Body() dto: UpdateTrackDto,
  ) {
    return this.events.updateTrack(p, eventId, trackId, dto);
  }
  @Delete(':eventId/tracks/:trackId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  deleteTrack(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('trackId', ParseUUIDPipe) trackId: string,
  ) {
    return this.events.deleteTrack(p, eventId, trackId);
  }
  @Get(':eventId/prizes') async prizes(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.events.prizes(eventId, await this.auth.resolve(request));
  }
  @Post(':eventId/prizes')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  createPrize(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: PrizeDto,
  ) {
    return this.events.createPrize(p, eventId, dto);
  }
  @Patch(':eventId/prizes/:prizeId')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  updatePrize(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('prizeId', ParseUUIDPipe) prizeId: string,
    @Body() dto: UpdatePrizeDto,
  ) {
    return this.events.updatePrize(p, eventId, prizeId, dto);
  }
  @Delete(':eventId/prizes/:prizeId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  deletePrize(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('prizeId', ParseUUIDPipe) prizeId: string,
  ) {
    return this.events.deletePrize(p, eventId, prizeId);
  }
  @Get(':eventId/registrations')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  registrations(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.registrations(p, eventId);
  }
  @Get(':eventId/memberships/me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  myMemberships(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.myMemberships(p, eventId);
  }
  @Get(':eventId/memberships')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  memberships(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.memberships(p, eventId);
  }
}
