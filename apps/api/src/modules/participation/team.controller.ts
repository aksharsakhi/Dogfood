import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import {
  CreateTeamDto,
  InvitationTokenDto,
  InviteDto,
  UpdateTeamDto,
} from './team.dto';
import { TeamService } from './team.service';
@ApiTags('Teams')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId/teams')
export class TeamController {
  constructor(@Inject(TeamService) private readonly teams: TeamService) {}
  @Post() create(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teams.create(p, eventId, dto);
  }
  @Get('me') mine(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.teams.mine(p, eventId);
  }
  @Get(':teamId') detail(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    return this.teams.detail(p, eventId, teamId);
  }
  @Patch(':teamId') rename(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teams.rename(p, eventId, teamId, dto);
  }
  @Post(':teamId/leave') @HttpCode(204) leave(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    return this.teams.leave(p, eventId, teamId);
  }
  @Post(':teamId/members/:userId/remove') @HttpCode(204) remove(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teams.remove(p, eventId, teamId, userId);
  }
  @Post(':teamId/invitations') invite(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: InviteDto,
  ) {
    return this.teams.invite(p, eventId, teamId, dto);
  }
  @Get(':teamId/invitations') invitations(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    return this.teams.invitations(p, eventId, teamId);
  }
  @Post(':teamId/invitations/:invitationId/revoke') @HttpCode(204) revoke(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.teams.revoke(p, eventId, teamId, invitationId);
  }
}
@ApiTags('Team invitations')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('team-invitations')
export class InvitationController {
  constructor(@Inject(TeamService) private readonly teams: TeamService) {}
  @Get(':token') preview(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('token') token: string,
  ) {
    return this.teams.preview(p, token);
  }
  @Post('accept') @HttpCode(200) accept(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: InvitationTokenDto,
  ) {
    return this.teams.accept(p, dto.token);
  }
  @Post('reject') @HttpCode(200) reject(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: InvitationTokenDto,
  ) {
    return this.teams.reject(p, dto.token);
  }
}
