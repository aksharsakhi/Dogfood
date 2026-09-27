import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Team } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import {
  CreateProjectDto,
  DraftDto,
  GalleryQueryDto,
  UpdateDraftDto,
  UpdateProjectDto,
} from './project.dto';

type Tx = Prisma.TransactionClient;
function assertHttpUrls(...values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (value == null) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      fail(400, 'INVALID_URL', 'Use a valid HTTP or HTTPS URL.');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      fail(400, 'INVALID_URL', 'Use a valid HTTP or HTTPS URL.');
  }
}
type GalleryRow = {
  id: string;
  slug: string;
  eventId: string;
  trackId: string | null;
  trackName: string | null;
  projectName: string;
  tagline: string | null;
  teamName: string;
  version: number;
  title: string;
  description: string;
  repositoryUrl: string | null;
  demoUrl: string | null;
  submittedAt: Date;
};

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async lockTeam(
    tx: Tx,
    eventId: string,
    teamId: string,
  ): Promise<Team> {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Team" WHERE id = ${teamId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
    if (!rows.length) fail(404, 'TEAM_NOT_FOUND', 'Team was not found.');
    return tx.team.findUniqueOrThrow({ where: { id: teamId } });
  }

  private async member(
    tx: Tx,
    principal: SessionPrincipal,
    eventId: string,
    team: Team,
  ): Promise<void> {
    const [member, participant] = await Promise.all([
      tx.teamMember.findFirst({
        where: {
          eventId,
          teamId: team.id,
          userId: principal.userId,
          leftAt: null,
        },
      }),
      tx.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId,
            userId: principal.userId,
            role: 'PARTICIPANT',
          },
        },
      }),
    ]);
    if (
      !member ||
      participant?.status !== 'ACTIVE' ||
      !['FORMING', 'ACTIVE'].includes(team.status)
    )
      fail(
        403,
        'FORBIDDEN',
        'Active team and participant membership are required.',
      );
  }

  private async eventWindow(tx: Tx, eventId: string, requireOpen: boolean) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (!['PUBLISHED', 'ACTIVE'].includes(event.status))
      fail(409, 'SUBMISSION_CLOSED', 'Project changes are closed.');
    const now = this.clock.now();
    if (event.submissionClosesAt && now >= event.submissionClosesAt)
      fail(409, 'SUBMISSION_CLOSED', 'The submission deadline has passed.');
    if (requireOpen && event.submissionOpensAt && now < event.submissionOpensAt)
      fail(409, 'SUBMISSION_NOT_OPEN', 'Submissions have not opened.');
    return { event, now };
  }

  private async track(
    tx: Tx,
    eventId: string,
    trackId: string | null | undefined,
  ) {
    if (!trackId) return;
    const track = await tx.track.findFirst({ where: { id: trackId, eventId } });
    if (!track)
      fail(400, 'INVALID_TRACK', 'Track does not belong to this event.');
  }

  private async projectForMember(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
  ) {
    const project = await this.db.project.findFirst({
      where: { id: projectId, eventId },
    });
    if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
    const [member, participant] = await Promise.all([
      this.db.teamMember.findFirst({
        where: {
          eventId,
          teamId: project.teamId,
          userId: principal.userId,
          leftAt: null,
          team: { status: { in: ['FORMING', 'ACTIVE'] } },
        },
      }),
      this.db.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId,
            userId: principal.userId,
            role: 'PARTICIPANT',
          },
        },
      }),
    ]);
    if (!member || participant?.status !== 'ACTIVE')
      fail(
        403,
        'FORBIDDEN',
        'Active team and participant membership are required.',
      );
    return project;
  }

  private async lockedProject(
    tx: Tx,
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
  ) {
    const project = await tx.project.findFirst({
      where: { id: projectId, eventId },
    });
    if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
    const team = await this.lockTeam(tx, eventId, project.teamId);
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Project" WHERE id = ${projectId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
    if (!rows.length) fail(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
    await this.member(tx, principal, eventId, team);
    if (!['DRAFT', 'ACTIVE'].includes(project.status))
      fail(409, 'PROJECT_LOCKED', 'This project cannot be changed.');
    return { project, team };
  }

  async create(
    principal: SessionPrincipal,
    eventId: string,
    dto: CreateProjectDto,
  ) {
    if (!dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Project name is required.');
    assertHttpUrls(dto.repositoryUrl, dto.demoUrl);
    try {
      return await this.db.$transaction(async (tx) => {
        const team = await this.lockTeam(tx, eventId, dto.teamId);
        await this.member(tx, principal, eventId, team);
        await this.eventWindow(tx, eventId, false);
        await this.track(tx, eventId, dto.trackId);
        const project = await tx.project.create({
          data: {
            eventId,
            teamId: team.id,
            trackId: dto.trackId,
            name: dto.name.trim(),
            slug: dto.slug,
            tagline: dto.tagline,
            description: dto.description,
            repositoryUrl: dto.repositoryUrl,
            demoUrl: dto.demoUrl,
          },
        });
        await this.audit.record(tx, {
          action: 'PROJECT_CREATED',
          entityType: 'Project',
          entityId: project.id,
          eventId,
          actorUserId: principal.userId,
          afterState: {
            name: project.name,
            slug: project.slug,
            teamId: team.id,
          },
        });
        return project;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'PROJECT_SLUG_TAKEN', 'Project slug is already in use.');
      throw error;
    }
  }

  async mine(principal: SessionPrincipal, eventId: string) {
    const participant = await this.db.eventMembership.findUnique({
      where: {
        eventId_userId_role: {
          eventId,
          userId: principal.userId,
          role: 'PARTICIPANT',
        },
      },
    });
    if (participant?.status !== 'ACTIVE')
      fail(403, 'FORBIDDEN', 'Active participant membership is required.');
    return this.db.project.findMany({
      where: {
        eventId,
        team: {
          status: { in: ['FORMING', 'ACTIVE'] },
          members: {
            some: {
              userId: principal.userId,
              leftAt: null,
            },
          },
        },
        status: { in: ['DRAFT', 'ACTIVE'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  detail(principal: SessionPrincipal, eventId: string, projectId: string) {
    return this.projectForMember(principal, eventId, projectId);
  }
  async update(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    if (dto.name !== undefined && !dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Project name is required.');
    assertHttpUrls(dto.repositoryUrl, dto.demoUrl);
    return this.db.$transaction(async (tx) => {
      const { project } = await this.lockedProject(
        tx,
        principal,
        eventId,
        projectId,
      );
      await this.eventWindow(tx, eventId, false);
      await this.track(tx, eventId, dto.trackId);
      const after = await tx.project.update({
        where: { id: projectId },
        data: {
          name: dto.name?.trim(),
          trackId: dto.trackId,
          tagline: dto.tagline,
          description: dto.description,
          repositoryUrl: dto.repositoryUrl,
          demoUrl: dto.demoUrl,
        },
      });
      await this.audit.record(tx, {
        action: 'PROJECT_UPDATED',
        entityType: 'Project',
        entityId: projectId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: project.name, trackId: project.trackId },
        afterState: { name: after.name, trackId: after.trackId },
      });
      return after;
    });
  }

  async history(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
  ) {
    await this.projectForMember(principal, eventId, projectId);
    return this.db.submission.findMany({
      where: { projectId },
      orderBy: { version: 'asc' },
    });
  }
  async latest(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
  ) {
    await this.projectForMember(principal, eventId, projectId);
    return this.db.submission.findFirst({
      where: { projectId, status: { in: ['SUBMITTED', 'LOCKED'] } },
      orderBy: { version: 'desc' },
    });
  }
  async draft(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
    dto: DraftDto,
  ) {
    if (!dto.title.trim() || !dto.description.trim())
      fail(
        400,
        'VALIDATION_ERROR',
        'Draft title and description are required.',
      );
    assertHttpUrls(dto.repositoryUrl, dto.demoUrl);
    return this.db.$transaction(async (tx) => {
      await this.lockedProject(tx, principal, eventId, projectId);
      await this.eventWindow(tx, eventId, true);
      const last = await tx.submission.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
      });
      if (last?.status === 'DRAFT')
        fail(
          409,
          'DRAFT_EXISTS',
          'Edit the existing draft before creating another version.',
        );
      const version = (last?.version ?? 0) + 1;
      const submission = await tx.submission.create({
        data: {
          projectId,
          version,
          title: dto.title.trim(),
          description: dto.description.trim(),
          repositoryUrl: dto.repositoryUrl,
          demoUrl: dto.demoUrl,
          createdById: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'SUBMISSION_DRAFT_CREATED',
        entityType: 'Submission',
        entityId: submission.id,
        eventId,
        actorUserId: principal.userId,
        afterState: { projectId, version },
      });
      return submission;
    });
  }
  async updateDraft(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
    submissionId: string,
    dto: UpdateDraftDto,
  ) {
    if (
      (dto.title !== undefined && !dto.title.trim()) ||
      (dto.description !== undefined && !dto.description.trim())
    )
      fail(
        400,
        'VALIDATION_ERROR',
        'Draft title and description cannot be blank.',
      );
    assertHttpUrls(dto.repositoryUrl, dto.demoUrl);
    return this.db.$transaction(async (tx) => {
      await this.lockedProject(tx, principal, eventId, projectId);
      await this.eventWindow(tx, eventId, true);
      const draft = await tx.submission.findFirst({
        where: { id: submissionId, projectId },
      });
      if (!draft)
        fail(404, 'SUBMISSION_NOT_FOUND', 'Submission was not found.');
      if (draft.status !== 'DRAFT')
        fail(409, 'SUBMISSION_IMMUTABLE', 'Submitted versions are immutable.');
      const after = await tx.submission.update({
        where: { id: submissionId },
        data: {
          title: dto.title?.trim(),
          description: dto.description?.trim(),
          repositoryUrl: dto.repositoryUrl,
          demoUrl: dto.demoUrl,
        },
      });
      await this.audit.record(tx, {
        action: 'SUBMISSION_DRAFT_UPDATED',
        entityType: 'Submission',
        entityId: submissionId,
        eventId,
        actorUserId: principal.userId,
        metadata: { projectId, version: draft.version },
      });
      return after;
    });
  }
  async submit(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
    submissionId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const { team, project } = await this.lockedProject(
        tx,
        principal,
        eventId,
        projectId,
      );
      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      const memberCount = await tx.teamMember.count({
        where: { teamId: team.id, eventId, leftAt: null },
      });
      if (team.status !== 'ACTIVE' || memberCount < event.minTeamSize)
        fail(409, 'TEAM_NOT_READY', 'The team must be active to submit.');
      const { now } = await this.eventWindow(tx, eventId, true);
      const draft = await tx.submission.findFirst({
        where: { id: submissionId, projectId },
      });
      if (!draft)
        fail(404, 'SUBMISSION_NOT_FOUND', 'Submission was not found.');
      if (draft.status !== 'DRAFT')
        fail(409, 'SUBMISSION_IMMUTABLE', 'This version is already submitted.');
      const last = await tx.submission.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (last?.id !== submissionId)
        fail(409, 'INVALID_VERSION', 'Only the latest draft can be submitted.');
      let trackName: string | null = null;
      if (project.trackId) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Track" WHERE id = ${project.trackId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
        if (!locked.length)
          fail(409, 'INVALID_TRACK', 'The project track is unavailable.');
        const track = await tx.track.findUniqueOrThrow({
          where: { id: project.trackId },
        });
        trackName = track.name;
        if (track.maxSubmissions !== null) {
          const used = await tx.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(DISTINCT s."projectId")::int AS count FROM "Submission" s
            JOIN "Project" p ON p.id = s."projectId"
            WHERE p."eventId" = ${eventId}::uuid AND s."trackId" = ${project.trackId}::uuid
              AND s.status IN ('SUBMITTED', 'LOCKED') AND p.id <> ${projectId}::uuid`;
          if ((used[0]?.count ?? 0) >= track.maxSubmissions)
            fail(
              409,
              'TRACK_FULL',
              'The track has reached its submission limit.',
            );
        }
      }
      const after = await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          projectName: project.name,
          projectTagline: project.tagline,
          trackId: project.trackId,
          trackName,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        action: 'SUBMISSION_SUBMITTED',
        entityType: 'Submission',
        entityId: submissionId,
        eventId,
        actorUserId: principal.userId,
        afterState: {
          projectId,
          version: draft.version,
          submittedAt: now.toISOString(),
        },
      });
      await this.eventWindow(tx, eventId, true);
      return after;
    });
  }

  private async publicEvent(eventId: string) {
    const event = await this.db.event.findFirst({
      where: {
        id: eventId,
        visibility: { in: ['PUBLIC', 'UNLISTED'] },
        status: { in: ['PUBLISHED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] },
      },
      select: { id: true, galleryVisibility: true, submissionClosesAt: true },
    });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (
      event.galleryVisibility === 'HIDDEN' ||
      (event.galleryVisibility === 'AFTER_SUBMISSIONS_CLOSE' &&
        (!event.submissionClosesAt ||
          this.clock.now() < event.submissionClosesAt))
    )
      fail(404, 'GALLERY_HIDDEN', 'Project gallery is currently hidden.');
  }
  private galleryWhere(eventId: string, query: GalleryQueryDto) {
    const search = query.search?.trim();
    const escaped = search?.replace(/[\\%_]/g, '\\$&');
    return Prisma.sql`p."eventId" = ${eventId}::uuid AND p.status = 'ACTIVE' AND
      e.visibility IN ('PUBLIC','UNLISTED') AND e.status IN ('PUBLISHED','ACTIVE','COMPLETED','ARCHIVED') AND
      (e."galleryVisibility" = 'PUBLIC' OR
        (e."galleryVisibility" = 'AFTER_SUBMISSIONS_CLOSE' AND e."submissionClosesAt" IS NOT NULL AND e."submissionClosesAt" <= ${this.clock.now()})) AND
      s.status IN ('SUBMITTED','LOCKED')
      ${query.trackId ? Prisma.sql`AND s."trackId" = ${query.trackId}::uuid` : Prisma.empty}
      ${escaped ? Prisma.sql`AND (s.title ILIKE ${`%${escaped}%`} ESCAPE '\\' OR s.description ILIKE ${`%${escaped}%`} ESCAPE '\\' OR s."projectName" ILIKE ${`%${escaped}%`} ESCAPE '\\' OR p.slug ILIKE ${`%${escaped}%`} ESCAPE '\\')` : Prisma.empty}`;
  }
  private galleryFrom(eventId: string, query: GalleryQueryDto) {
    return Prisma.sql`FROM "Project" p
      JOIN "Event" e ON e.id = p."eventId"
      JOIN LATERAL (SELECT id, version, title, description, "repositoryUrl", "demoUrl", "submittedAt", status,
        "projectName", "projectTagline", "trackId", "trackName"
        FROM "Submission" WHERE "projectId" = p.id AND status <> 'DRAFT'
        ORDER BY version DESC LIMIT 1) s ON TRUE
      JOIN "Team" t ON t.id = p."teamId"
      WHERE ${this.galleryWhere(eventId, query)}`;
  }
  async gallery(eventId: string, query: GalleryQueryDto) {
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.page > 1_000_000 ||
      !Number.isSafeInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 50
    ) {
      fail(400, 'VALIDATION_ERROR', 'Gallery pagination is invalid.');
    }
    await this.publicEvent(eventId);
    const from = this.galleryFrom(eventId, query);
    const count = await this.db.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS total ${from}`,
    );
    const offset = (query.page - 1) * query.pageSize;
    const items = await this.db.$queryRaw<GalleryRow[]>(Prisma.sql`
      SELECT p.id, p.slug, p."eventId", s."trackId", s."trackName", s."projectName", s."projectTagline" AS tagline, t.name AS "teamName",
        s.version, s.title, s.description, s."repositoryUrl", s."demoUrl", s."submittedAt"
      ${from} ORDER BY s."submittedAt" DESC, p.id ASC LIMIT ${query.pageSize} OFFSET ${offset}`);
    return {
      items,
      total: count[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async galleryDetail(eventId: string, projectId: string) {
    await this.publicEvent(eventId);
    const rows = await this.db.$queryRaw<GalleryRow[]>(Prisma.sql`
      SELECT p.id, p.slug, p."eventId", s."trackId", s."trackName", s."projectName", s."projectTagline" AS tagline, t.name AS "teamName",
        s.version, s.title, s.description, s."repositoryUrl", s."demoUrl", s."submittedAt"
      ${this.galleryFrom(eventId, new GalleryQueryDto())} AND p.id = ${projectId}::uuid LIMIT 1`);
    if (!rows.length) fail(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
    return rows[0];
  }
}
