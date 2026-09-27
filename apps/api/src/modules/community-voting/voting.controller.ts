import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { AuthService } from '../identity/auth.service';
import {
  CastVoteDto,
  CommentPageQueryDto,
  PostCommentDto,
  VotingAuditQueryDto,
  VotingConfigDto,
  VoterDto,
} from './voting.dto';
import {
  CommunityVotingService,
  voterCookieName,
  VotingRateLimitError,
} from './voting.service';

@ApiTags('Community voting')
@Controller('events/:eventId/voting')
export class CommunityVotingController {
  constructor(
    @Inject(CommunityVotingService)
    private readonly voting: CommunityVotingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private cookie(reply: FastifyReply, eventId: string, token?: string) {
    if (token)
      reply.setCookie(voterCookieName(eventId), token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: `/events/${eventId}/voting`,
        maxAge: 365 * 24 * 60 * 60,
      });
  }

  @Post('ballot')
  async ballot(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: VoterDto,
  ) {
    const result = await this.voting.ballot(eventId, request, dto);
    this.cookie(reply, eventId, result.cookie);
    return { items: result.items, alreadyVoted: result.alreadyVoted };
  }

  @Post('votes')
  async cast(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: CastVoteDto,
  ) {
    try {
      const result = await this.voting.cast(eventId, request, dto);
      this.cookie(reply, eventId, result.cookie);
      return result.vote;
    } catch (error) {
      if (error instanceof VotingRateLimitError)
        reply.header('Retry-After', error.retryAfterSeconds);
      throw error;
    }
  }

  @Get('results')
  async results(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.voting.results(eventId, await this.auth.resolve(request));
  }

  @Get('projects/:projectId/comments')
  comments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: CommentPageQueryDto,
  ) {
    return this.voting.comments(eventId, projectId, query);
  }

  @Post('projects/:projectId/comments')
  async postComment(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: PostCommentDto,
  ) {
    try {
      const result = await this.voting.postComment(
        eventId,
        projectId,
        request,
        dto,
      );
      this.cookie(reply, eventId, result.cookie);
      return result.comment;
    } catch (error) {
      if (error instanceof VotingRateLimitError)
        reply.header('Retry-After', error.retryAfterSeconds);
      throw error;
    }
  }

  @Patch('projects/:projectId/comments/:commentId/hide')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  hide(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.voting.hide(eventId, projectId, commentId, principal);
  }

  @Patch('config')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  configure(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: VotingConfigDto,
  ) {
    return this.voting.configure(eventId, principal, dto);
  }

  @Get('config')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  config(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.voting.config(eventId, principal);
  }

  @Get('audit')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  audit(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: VotingAuditQueryDto,
  ) {
    return this.voting.auditLog(eventId, principal, query);
  }
}
