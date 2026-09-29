import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { PairwiseRankingService } from './ranking.service';
import { PairwiseRankingDto } from './ranking.dto';
import { PairwiseService } from './pairwise.service';
import { PairwisePublishDto, PairwiseSubmitDto } from './pairwise.dto';

@ApiTags('Pairwise Judging')
@ApiCookieAuth()
@ApiResponse({ status: 401, description: 'Session authentication required' })
@ApiResponse({ status: 403, description: 'Event role required' })
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId/judging/pairwise')
export class PairwiseController {
  constructor(
    @Inject(PairwiseService) private readonly service: PairwiseService,
    @Inject(PairwiseRankingService)
    private readonly rankings: PairwiseRankingService,
  ) {}

  @Post('runs/:runId/rankings')
  @ApiOperation({
    summary:
      'Create an immutable Bradley–Terry ranking, or reuse identical evidence',
  })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiResponse({
    status: 201,
    type: PairwiseRankingDto,
    description: 'Ranking created or identical historical ranking reused',
  })
  @ApiResponse({ status: 400, description: 'Invalid identifier' })
  @ApiResponse({ status: 404, description: 'Run not found in this event' })
  @ApiResponse({
    status: 409,
    description:
      'Run not published, disconnected evidence, or solver failure. Disconnected details contain componentCount, components (project IDs), isolatedProjects, comparisonCount and projectCount.',
  })
  createRanking(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.rankings.create(p, eventId, runId);
  }

  @Get('runs/:runId/rankings')
  @ApiOperation({
    summary:
      'List historical pairwise rankings with current evidence staleness',
  })
  @ApiResponse({ status: 200, type: [PairwiseRankingDto] })
  @ApiResponse({ status: 400, description: 'Invalid identifier' })
  @ApiResponse({ status: 404, description: 'Run not found in this event' })
  listRankings(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.rankings.list(p, eventId, runId);
  }

  @Get('rankings/:rankingRunId')
  @ApiOperation({
    summary: 'Read an immutable pairwise ranking with frozen project names',
  })
  @ApiResponse({ status: 200, type: PairwiseRankingDto })
  @ApiResponse({ status: 400, description: 'Invalid identifier' })
  @ApiResponse({ status: 404, description: 'Ranking not found in this event' })
  rankingDetail(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rankingRunId', ParseUUIDPipe) rankingRunId: string,
  ) {
    return this.rankings.detail(p, eventId, rankingRunId);
  }

  @Post('runs')
  @ApiOperation({ summary: 'Create a draft pairwise run' })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiResponse({ status: 201, description: 'Draft run created' })
  @ApiResponse({ status: 403, description: 'Organizer role required' })
  create(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.create(p, eventId);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List pairwise runs for an event' })
  list(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.list(p, eventId);
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Inspect a pairwise run' })
  detail(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.detail(p, eventId, runId);
  }

  @Post('runs/:runId/assignments/preview')
  @ApiOperation({
    summary: 'Preview deterministic pairwise assignments and feasibility',
  })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  preview(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.preview(p, eventId, runId);
  }

  @Post('runs/:runId/publish')
  @ApiOperation({ summary: 'Publish a matching pairwise proposal atomically' })
  @ApiResponse({ status: 409, description: 'Stale or infeasible proposal' })
  publish(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: PairwisePublishDto,
  ) {
    return this.service.publish(p, eventId, runId, dto.proposalHash);
  }

  @Post('runs/:runId/close')
  @ApiOperation({ summary: 'Close a published pairwise run' })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  close(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.close(p, eventId, runId);
  }

  @Get('runs/:runId/progress')
  @ApiOperation({ summary: 'Inspect pairwise assignment completion and graph' })
  progress(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.progress(p, eventId, runId);
  }

  @Get('workspace')
  @ApiOperation({
    summary:
      'List the current judge’s pairwise assignments with pinned submissions',
  })
  workspace(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.workspace(p, eventId);
  }

  @Post('assignments/:assignmentId/submit')
  @ApiOperation({ summary: 'Submit the assigned pairwise comparison' })
  @ApiResponse({ status: 409, description: 'Already submitted or run closed' })
  submit(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: PairwiseSubmitDto,
  ) {
    return this.service.submit(p, eventId, assignmentId, dto.winnerProjectId);
  }
}
