import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { OnboardingService } from './onboarding.service';
import { EvaluationsService } from './evaluations.service';
import { BatchService } from './batch.service';
import { ScoringService } from './scoring.service';
import { CsvExportService } from './csv-export.service';
import {
  ConflictDto,
  JudgeInviteDto,
  JudgeInviteTokenDto,
  JudgeProfileDto,
  RubricDto,
  ManualAssignmentDto,
  EvaluationDto,
  BatchPreviewDto,
  PublishPreviewDto,
  CreateScoreRunDto,
  CreateResultRunDto,
} from './judging.dto';

@ApiTags('Judging')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId/judging')
export class JudgingController {
  constructor(
    @Inject(OnboardingService) private readonly service: OnboardingService,
    @Inject(EvaluationsService)
    private readonly evaluations: EvaluationsService,
    @Inject(BatchService) private readonly batch: BatchService,
    @Inject(ScoringService) private readonly scoring: ScoringService,
    @Inject(CsvExportService) private readonly csvExport: CsvExportService,
  ) {}
  @Post('assignments/preflight') preflight(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: BatchPreviewDto,
  ) {
    return this.batch.preflight(p, eventId, dto);
  }
  @Post('assignments/preview') previewAssignments(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: BatchPreviewDto,
  ) {
    return this.batch.preview(p, eventId, dto);
  }
  @Get('assignments/runs/:runId') run(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.batch.run(p, eventId, runId);
  }
  @Post('assignments/runs/:runId/publish') publishAssignments(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: PublishPreviewDto,
  ) {
    return this.batch.publish(p, eventId, runId, dto);
  }
  @Get('progress') progress(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('reviewsPerSubmission', ParseIntPipe) reviewsPerSubmission: number,
  ) {
    return this.batch.progress(p, eventId, reviewsPerSubmission);
  }
  @Post('assignments/manual')
  manual(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ManualAssignmentDto,
  ) {
    return this.evaluations.manual(p, eventId, dto);
  }
  @Get('workspace')
  workspace(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.evaluations.workspace(p, eventId);
  }
  @Get('judges/:judgeId/scores')
  judgeScores(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('judgeId', ParseUUIDPipe) judgeId: string,
  ) {
    return this.evaluations.scoresForJudge(p, eventId, judgeId);
  }
  @Get('submissions/:submissionId')
  submission(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.evaluations.submission(p, eventId, submissionId);
  }
  @Get('assignments/:assignmentId')
  assignment(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.evaluations.detail(p, eventId, assignmentId);
  }
  @Patch('assignments/:assignmentId/evaluation')
  draftEvaluation(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: EvaluationDto,
  ) {
    return this.evaluations.save(p, eventId, assignmentId, dto, false);
  }
  @Post('assignments/:assignmentId/evaluation/submit')
  submitEvaluation(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: EvaluationDto,
  ) {
    return this.evaluations.save(p, eventId, assignmentId, dto, true);
  }
  @Post('invitations') invite(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: JudgeInviteDto,
  ) {
    return this.service.invite(p, eventId, dto);
  }
  @Get('invitations') invitations(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.invitations(p, eventId);
  }
  @Post('invitations/:invitationId/revoke') @HttpCode(204) revoke(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.service.revoke(p, eventId, invitationId);
  }
  @Get('judges') judges(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.judges(p, eventId);
  }
  @Patch('judges/:profileId') profile(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: JudgeProfileDto,
  ) {
    return this.service.profile(p, eventId, profileId, dto);
  }
  @Get('conflicts') conflicts(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.conflicts(p, eventId);
  }
  @Post('conflicts') conflict(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ConflictDto,
  ) {
    return this.service.declareConflict(p, eventId, dto);
  }
  @Delete('conflicts/:conflictId') @HttpCode(204) removeConflict(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conflictId', ParseUUIDPipe) conflictId: string,
  ) {
    return this.service.removeConflict(p, eventId, conflictId);
  }
  @Get('rubrics') rubrics(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.service.rubrics(p, eventId);
  }
  @Post('rubrics') rubric(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RubricDto,
  ) {
    return this.service.createRubric(p, eventId, dto);
  }
  @Patch('rubrics/:rubricId') updateRubric(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
    @Body() dto: RubricDto,
  ) {
    return this.service.updateRubric(p, eventId, rubricId, dto);
  }
  @Post('rubrics/:rubricId/publish') publishRubric(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rubricId', ParseUUIDPipe) rubricId: string,
  ) {
    return this.service.publishRubric(p, eventId, rubricId);
  }

  @Post('scoring/runs')
  createScoreRun(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateScoreRunDto,
  ) {
    return this.scoring.createScoreRun(p, eventId, dto);
  }

  @Get('scoring/runs')
  listScoreRuns(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.scoring.listScoreRuns(p, eventId);
  }

  @Get('scoring/runs/:runId')
  getScoreRun(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.scoring.getScoreRunDetail(p, eventId, runId);
  }

  @Post('results/runs')
  createResultRun(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateResultRunDto,
  ) {
    return this.scoring.createResultRun(p, eventId, dto);
  }

  @Get('results/runs')
  listResultRuns(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.scoring.listResultRuns(p, eventId);
  }

  @Get('results/runs/:runId')
  getResultRun(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.scoring.getResultRunDetail(p, eventId, runId);
  }

  @Get('exports/judges')
  async exportJudges(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportJudges(p, eventId);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="judges-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/assignments')
  async exportAssignments(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportAssignments(p, eventId);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="assignments-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/progress')
  async exportProgress(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('reviewsPerSubmission') reviewsPerSubmission: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const reviews = reviewsPerSubmission
      ? parseInt(reviewsPerSubmission, 10)
      : 2;
    const csv = await this.csvExport.exportProgress(p, eventId, reviews);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="progress-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/raw-evaluations')
  async exportRawEvaluations(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportRawEvaluations(p, eventId);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="raw-evaluations-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/normalized-scores')
  async exportNormalizedScores(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('scoreRunId') scoreRunId: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportNormalizedScores(
      p,
      eventId,
      scoreRunId,
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="normalized-scores-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/project-scores')
  async exportProjectScores(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('scoreRunId') scoreRunId: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportProjectScores(
      p,
      eventId,
      scoreRunId,
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="project-scores-${eventId}.csv"`,
    );
    return csv;
  }

  @Get('exports/results')
  async exportResults(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('resultRunId') resultRunId: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.csvExport.exportResults(p, eventId, resultRunId);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="results-${eventId}.csv"`,
    );
    return csv;
  }
}

@ApiTags('Judge invitations')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('judge-invitations')
export class JudgeInvitationController {
  constructor(
    @Inject(OnboardingService) private readonly service: OnboardingService,
  ) {}
  @Post('accept') @HttpCode(200) accept(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: JudgeInviteTokenDto,
  ) {
    return this.service.accept(p, dto.token);
  }
}
