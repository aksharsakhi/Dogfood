import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { SessionPrincipal } from '@dogfood/shared';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import {
  CreateProjectDto,
  DraftDto,
  GalleryQueryDto,
  UpdateDraftDto,
  UpdateProjectDto,
} from './project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects and submissions')
@ApiCookieAuth()
@UseGuards(SessionAuthGuard)
@Controller('events/:eventId/projects')
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Post() create(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(p, eventId, dto);
  }
  @Get('me') mine(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.projects.mine(p, eventId);
  }
  @Get(':projectId') detail(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.projects.detail(p, eventId, projectId);
  }
  @Patch(':projectId') update(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(p, eventId, projectId, dto);
  }
  @Get(':projectId/submissions') history(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.projects.history(p, eventId, projectId);
  }
  @Get(':projectId/submissions/latest') latest(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.projects.latest(p, eventId, projectId);
  }
  @Post(':projectId/submissions') draft(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: DraftDto,
  ) {
    return this.projects.draft(p, eventId, projectId, dto);
  }
  @Patch(':projectId/submissions/:submissionId') updateDraft(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.projects.updateDraft(p, eventId, projectId, submissionId, dto);
  }
  @Post(':projectId/submissions/:submissionId/submit') submit(
    @CurrentPrincipal() p: SessionPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ) {
    return this.projects.submit(p, eventId, projectId, submissionId);
  }
}

@ApiTags('Public gallery')
@Controller('events/:eventId/gallery')
export class GalleryController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get('embed-meta') embedMeta(
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.projects.galleryEmbedMeta(eventId);
  }
  @Get() list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: GalleryQueryDto,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(12), ParseIntPipe) pageSize: number,
  ) {
    return this.projects.gallery(eventId, { ...query, page, pageSize });
  }
  @Get(':projectId') detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.projects.galleryDetail(eventId, projectId);
  }
}
