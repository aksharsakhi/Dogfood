import { Inject, Injectable } from '@nestjs/common';
import { Prisma, VotingAccessMode } from '@prisma/client';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { Clock } from '../../common/time';
import { AccessService } from '../../common/auth/access.service';
import { DomainError, fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { AuthService, normalizeEmail } from '../identity/auth.service';
import {
  CastVoteDto,
  CommentPageQueryDto,
  PostCommentDto,
  VotingAuditQueryDto,
  VotingConfigDto,
  VoterDto,
} from './voting.dto';

type Tx = Prisma.TransactionClient;
type Principal = SessionPrincipal | null;
type Identity = { id: string; userId: string | null; mode: VotingAccessMode };
const minute = 60_000;
const bucketMs = 10 * minute;
const limits = { VOTE: 6, COMMENT: 12 } as const;
export const voterCookieName = (eventId: string): string =>
  `dogfood_voter_${eventId.replace(/-/g, '')}`;
const sha = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );

export class VotingRateLimitError extends DomainError {
  constructor(
    readonly retryAfterSeconds: number,
    action: 'VOTE' | 'COMMENT',
  ) {
    super(
      429,
      'RATE_LIMITED',
      `Too many ${action.toLowerCase()} attempts. Retry after ${retryAfterSeconds} seconds.`,
    );
  }
}

@Injectable()
export class CommunityVotingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private key(): string {
    const secret = process.env.VOTING_TOKEN_SECRET;
    if (!secret)
      throw new Error('VOTING_TOKEN_SECRET is required at API startup.');
    return secret;
  }

  private hmac(purpose: string, value: string): string {
    return createHmac('sha256', this.key())
      .update(`${purpose}:${value}`)
      .digest('hex');
  }

  private async event(tx: Tx, eventId: string, requirePublic: boolean) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (requirePublic) {
      if (
        !['PUBLIC', 'UNLISTED'].includes(event.visibility) ||
        !['PUBLISHED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].includes(
          event.status,
        ) ||
        event.galleryVisibility === 'HIDDEN' ||
        (event.galleryVisibility === 'AFTER_SUBMISSIONS_CLOSE' &&
          (!event.submissionClosesAt ||
            this.clock.now() < event.submissionClosesAt))
      )
        fail(404, 'GALLERY_HIDDEN', 'Project gallery is currently hidden.');
    }
    return event;
  }

  private async eligible(tx: Tx, eventId: string) {
    const rows = await tx.project.findMany({
      where: { eventId, status: 'ACTIVE' },
      select: {
        id: true,
        eventId: true,
        teamId: true,
        name: true,
        slug: true,
        submissions: {
          where: { status: { not: 'DRAFT' } },
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            title: true,
            description: true,
            status: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.filter((row) =>
      ['SUBMITTED', 'LOCKED'].includes(row.submissions[0]?.status ?? ''),
    );
  }

  private async lockProject(
    tx: Tx,
    eventId: string,
    projectId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Project" WHERE id = ${projectId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
    if (!rows.length)
      fail(
        404,
        'PROJECT_NOT_FOUND',
        'This project is not in the public gallery.',
      );
  }

  private window(
    event: { votingOpensAt: Date | null; votingClosesAt: Date | null },
    now: Date,
  ): void {
    if (!event.votingOpensAt || now < event.votingOpensAt)
      fail(409, 'VOTING_NOT_OPEN', 'Voting has not opened.');
    if (!event.votingClosesAt || now >= event.votingClosesAt)
      fail(409, 'VOTING_CLOSED', 'Voting has closed.');
  }

  private async identity(
    eventId: string,
    request: FastifyRequest,
    dto: VoterDto,
  ): Promise<{ identity: Identity; cookie?: string }> {
    try {
      return await this.resolveIdentity(eventId, request, dto);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        fail(409, 'WRONG_VOTING_MODE', 'The voting access mode changed.');
      throw error;
    }
  }

  private async createIdentity(
    eventId: string,
    mode: VotingAccessMode,
    data: Prisma.VotingIdentityUncheckedCreateInput,
    actorUserId?: string,
  ): Promise<Identity> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.votingAccessMode !== mode)
        fail(409, 'WRONG_VOTING_MODE', 'The voting access mode changed.');
      const selector: Prisma.VotingIdentityWhereInput = {
        eventId,
        mode,
        ...(data.userId ? { userId: data.userId } : {}),
        ...(data.emailHash ? { emailHash: data.emailHash } : {}),
        ...(data.openTokenHash ? { openTokenHash: data.openTokenHash } : {}),
      };
      const prior = await tx.votingIdentity.findFirst({
        where: selector,
        select: { id: true, userId: true, mode: true },
      });
      if (prior) return prior;
      const created = await tx.votingIdentity.create({
        data,
        select: { id: true, userId: true, mode: true },
      });
      await this.audit.record(tx, {
        action: 'VOTING_IDENTITY_CREATED',
        entityType: 'VotingIdentity',
        entityId: created.id,
        eventId,
        actorUserId,
        afterState: { mode },
      });
      return created;
    });
  }

  private async resolveIdentity(
    eventId: string,
    request: FastifyRequest,
    dto: VoterDto,
  ): Promise<{ identity: Identity; cookie?: string }> {
    const event = await this.event(this.db, eventId, true);
    if (event.votingAccessMode === 'AUTHENTICATED') {
      if (dto.email !== undefined)
        fail(
          400,
          'WRONG_VOTING_MODE',
          'Email identity is not used for this event.',
        );
      const principal = await this.auth.resolve(request);
      if (!principal)
        fail(401, 'UNAUTHENTICATED', 'Authentication is required.');
      const row = await this.createIdentity(
        eventId,
        'AUTHENTICATED',
        { eventId, mode: 'AUTHENTICATED', userId: principal.userId },
        principal.userId,
      );
      return { identity: row };
    }
    if (event.votingAccessMode === 'EMAIL_GATED') {
      if (!dto.email)
        fail(
          400,
          'EMAIL_REQUIRED',
          'An email address is required for this event.',
        );
      const emailHash = this.hmac('email', normalizeEmail(dto.email));
      const row = await this.createIdentity(eventId, 'EMAIL_GATED', {
        eventId,
        mode: 'EMAIL_GATED',
        emailHash,
        emailAcceptedAt: this.clock.now(),
      });
      return { identity: row };
    }
    if (dto.email !== undefined)
      fail(
        400,
        'WRONG_VOTING_MODE',
        'Email identity is not used for this event.',
      );
    const presented = request.cookies?.[voterCookieName(eventId)];
    if (presented) {
      const match = /^([A-Za-z0-9_-]{43})\.([a-f0-9]{64})$/.exec(presented);
      const expected = match
        ? this.hmac('open-token', `${eventId}:${match[1]}`)
        : '';
      if (
        !match ||
        !timingSafeEqual(Buffer.from(match[2]!), Buffer.from(expected))
      )
        fail(
          401,
          'INVALID_VOTER_TOKEN',
          'The browser voting credential is invalid.',
        );
      const existing = await this.db.votingIdentity.findUnique({
        where: {
          eventId_openTokenHash: { eventId, openTokenHash: sha(match[1]!) },
        },
        select: { id: true, userId: true, mode: true },
      });
      if (!existing || existing.mode !== 'OPEN')
        fail(
          401,
          'INVALID_VOTER_TOKEN',
          'The browser voting credential is invalid.',
        );
      return { identity: existing };
    }
    const nonce = randomBytes(32).toString('base64url');
    const signature = this.hmac('open-token', `${eventId}:${nonce}`);
    const row = await this.createIdentity(eventId, 'OPEN', {
      eventId,
      mode: 'OPEN',
      openTokenHash: sha(nonce),
    });
    return { identity: row, cookie: `${nonce}.${signature}` };
  }

  async ballot(eventId: string, request: FastifyRequest, dto: VoterDto) {
    const resolved = await this.identity(eventId, request, dto);
    const alreadyVoted = !!(await this.db.communityVote.findUnique({
      where: {
        eventId_identityId: { eventId, identityId: resolved.identity.id },
      },
      select: { id: true },
    }));
    const projects = await this.eligible(this.db, eventId);
    const items = projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      title: project.submissions[0]!.title,
      description: project.submissions[0]!.description,
    }));
    items.sort((a, b) => {
      const ah = this.hmac(
        'ballot',
        `${eventId}:${resolved.identity.id}:${a.id}`,
      );
      const bh = this.hmac(
        'ballot',
        `${eventId}:${resolved.identity.id}:${b.id}`,
      );
      return ah.localeCompare(bh) || a.id.localeCompare(b.id);
    });
    return { items, alreadyVoted, cookie: resolved.cookie };
  }

  private async throttle(
    eventId: string,
    action: 'VOTE' | 'COMMENT',
    identityId: string,
  ): Promise<void> {
    const now = this.clock.now();
    const windowStart = new Date(
      Math.floor(now.getTime() / bucketMs) * bucketMs,
    );
    const subjectHash = this.hmac('bucket', identityId);
    const bucket = await this.db.publicWriteBucket.upsert({
      where: {
        eventId_action_subjectHash_windowStart: {
          eventId,
          action,
          subjectHash,
          windowStart,
        },
      },
      create: { eventId, action, subjectHash, windowStart, attemptCount: 1 },
      update: { attemptCount: { increment: 1 } },
      select: { attemptCount: true },
    });
    if (bucket.attemptCount > limits[action]) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart.getTime() + bucketMs - now.getTime()) / 1000),
      );
      throw new VotingRateLimitError(retryAfterSeconds, action);
    }
  }

  private signal(request: FastifyRequest): string {
    return this.hmac(
      'abuse-signal',
      `${request.ip}|${request.headers['user-agent'] ?? ''}`,
    );
  }

  async cast(eventId: string, request: FastifyRequest, dto: CastVoteDto) {
    const { identity, cookie } = await this.identity(eventId, request, dto);
    await this.throttle(eventId, 'VOTE', identity.id);
    const signal = this.signal(request);
    try {
      const vote = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
        const now = this.clock.now();
        const event = await this.event(tx, eventId, true);
        this.window(event, now);
        const current = await tx.votingIdentity.findFirst({
          where: { id: identity.id, eventId, mode: event.votingAccessMode },
          select: { id: true },
        });
        if (!current)
          fail(
            409,
            'WRONG_VOTING_MODE',
            'Voting identity does not match this event.',
          );
        await this.lockProject(tx, eventId, dto.projectId);
        const project = (await this.eligible(tx, eventId)).find(
          (row) => row.id === dto.projectId,
        );
        if (!project)
          fail(
            404,
            'PROJECT_NOT_FOUND',
            'This project is not on the public ballot.',
          );
        if (identity.mode === 'AUTHENTICATED' && identity.userId) {
          const self = await tx.teamMember.findFirst({
            where: { eventId, teamId: project.teamId, userId: identity.userId },
            select: { id: true },
          });
          if (self)
            fail(
              403,
              'SELF_VOTE_FORBIDDEN',
              'You cannot vote for your own team project.',
            );
        }
        const prior = await tx.communityVote.findMany({
          where: {
            eventId,
            abuseSignalHash: signal,
            castAt: { gte: new Date(now.getTime() - 60 * minute) },
          },
          select: { identityId: true, castAt: true },
          take: 20,
          orderBy: { castAt: 'desc' },
        });
        const created = await tx.communityVote.create({
          data: {
            eventId,
            projectId: dto.projectId,
            identityId: identity.id,
            abuseSignalHash: signal,
            castAt: now,
          },
          select: { id: true, projectId: true, castAt: true },
        });
        await this.audit.record(tx, {
          action: 'COMMUNITY_VOTE_CAST',
          entityType: 'CommunityVote',
          entityId: created.id,
          eventId,
          actorUserId: identity.userId ?? undefined,
          metadata: { projectId: dto.projectId, identityId: identity.id },
        });
        const related = prior.filter((row) => row.identityId !== identity.id);
        if (
          related.length >= 2 ||
          related.some((row) => now.getTime() - row.castAt.getTime() < 10_000)
        ) {
          await this.audit.record(tx, {
            action: 'COMMUNITY_VOTE_FLAGGED',
            entityType: 'CommunityVote',
            entityId: created.id,
            eventId,
            metadata: {
              reason:
                related.length >= 2
                  ? 'Multiple identities share a request fingerprint'
                  : 'Related identities voted within ten seconds',
              relatedIdentityCount: related.length,
              identityId: identity.id,
            },
          });
        }
        return created;
      });
      return { vote, cookie };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          409,
          'ALREADY_VOTED',
          'This voting identity has already voted in this event.',
        );
      throw error;
    }
  }

  async comments(
    eventId: string,
    projectId: string,
    query: CommentPageQueryDto,
  ) {
    await this.event(this.db, eventId, true);
    const project = (await this.eligible(this.db, eventId)).find(
      (row) => row.id === projectId,
    );
    if (!project)
      fail(
        404,
        'PROJECT_NOT_FOUND',
        'This project is not in the public gallery.',
      );
    const cursor = query.cursor
      ? await this.db.projectComment.findFirst({
          where: { id: query.cursor, eventId, projectId, status: 'VISIBLE' },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursor)
      fail(400, 'INVALID_COMMENT_CURSOR', 'Comment cursor is invalid.');
    const pageSize = query.pageSize ?? 200;
    const rows = await this.db.projectComment.findMany({
      where: {
        eventId,
        projectId,
        status: 'VISIBLE',
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, body: true, createdAt: true },
      take: pageSize + 1,
    });
    const page = rows.slice(0, pageSize);
    return {
      items: page.map((row) => ({ ...row, body: escapeHtml(row.body) })),
      nextCursor: rows.length > pageSize ? page.at(-1)!.id : null,
    };
  }

  async config(eventId: string, principal: SessionPrincipal) {
    await this.access.organizer(principal, eventId);
    const event = await this.event(this.db, eventId, false);
    const votingConfigLocked = !!(await this.db.votingIdentity.findFirst({
      where: { eventId },
      select: { id: true },
    }));
    return {
      accessMode: event.votingAccessMode,
      votingOpensAt: event.votingOpensAt,
      votingClosesAt: event.votingClosesAt,
      votingConfigLocked,
    };
  }

  async postComment(
    eventId: string,
    projectId: string,
    request: FastifyRequest,
    dto: PostCommentDto,
  ) {
    const body = dto.body.trim();
    if (!body || body.length > 2000)
      fail(400, 'VALIDATION_ERROR', 'Comment must be 1–2000 characters.');
    const { identity, cookie } = await this.identity(eventId, request, dto);
    await this.throttle(eventId, 'COMMENT', identity.id);
    const now = this.clock.now();
    const comment = await this.db.$transaction(async (tx) => {
      await this.lockProject(tx, eventId, projectId);
      const project = (await this.eligible(tx, eventId)).find(
        (row) => row.id === projectId,
      );
      if (!project)
        fail(
          404,
          'PROJECT_NOT_FOUND',
          'This project is not in the public gallery.',
        );
      const event = await this.event(tx, eventId, true);
      const current = await tx.votingIdentity.findFirst({
        where: { id: identity.id, eventId, mode: event.votingAccessMode },
        select: { id: true },
      });
      if (!current)
        fail(
          409,
          'WRONG_VOTING_MODE',
          'Voting identity does not match this event.',
        );
      const created = await tx.projectComment.create({
        data: {
          eventId,
          projectId,
          identityId: identity.id,
          body,
          createdAt: now,
        },
        select: { id: true, body: true, createdAt: true },
      });
      await this.audit.record(tx, {
        action: 'PROJECT_COMMENT_POSTED',
        entityType: 'ProjectComment',
        entityId: created.id,
        eventId,
        actorUserId: identity.userId ?? undefined,
        metadata: { projectId, identityId: identity.id },
      });
      return created;
    });
    return { comment: { ...comment, body: escapeHtml(comment.body) }, cookie };
  }

  async hide(
    eventId: string,
    projectId: string,
    commentId: string,
    principal: SessionPrincipal,
  ) {
    await this.access.organizer(principal, eventId);
    return this.db.$transaction(async (tx) => {
      const comment = await tx.projectComment.findFirst({
        where: { id: commentId, eventId, projectId },
      });
      if (!comment) fail(404, 'COMMENT_NOT_FOUND', 'Comment was not found.');
      if (comment.status === 'HIDDEN')
        return { id: comment.id, status: 'HIDDEN' };
      const updated = await tx.projectComment.update({
        where: { id: commentId },
        data: {
          status: 'HIDDEN',
          hiddenAt: this.clock.now(),
          hiddenById: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'PROJECT_COMMENT_HIDDEN',
        entityType: 'ProjectComment',
        entityId: commentId,
        eventId,
        actorUserId: principal.userId,
        metadata: { projectId },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  async results(eventId: string, principal: Principal) {
    const organizer = principal
      ? this.access.isAdmin(principal) ||
        (await this.access.hasRole(principal, eventId, 'ORGANIZER'))
      : false;
    const event = await this.event(this.db, eventId, !organizer);
    const now = this.clock.now();
    if (!organizer && (!event.votingClosesAt || now < event.votingClosesAt))
      fail(
        403,
        'RESULTS_HIDDEN',
        'Community voting results are not available yet.',
      );
    const projects = await this.eligible(this.db, eventId);
    const counts = await this.db.communityVote.groupBy({
      by: ['projectId'],
      where: { eventId, projectId: { in: projects.map((row) => row.id) } },
      _count: { _all: true },
    });
    const tally = new Map(
      counts.map((row) => [row.projectId, row._count._all]),
    );
    return {
      items: projects.map((row) => ({
        projectId: row.id,
        title: row.submissions[0]!.title,
        votes: tally.get(row.id) ?? 0,
      })),
    };
  }

  async configure(
    eventId: string,
    principal: SessionPrincipal,
    dto: VotingConfigDto,
  ) {
    await this.access.organizer(principal, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const before = await this.event(tx, eventId, false);
      const mode = dto.accessMode ?? before.votingAccessMode;
      if (
        mode !== before.votingAccessMode &&
        (await tx.votingIdentity.count({ where: { eventId } }))
      )
        fail(
          409,
          'VOTING_MODE_LOCKED',
          'Access mode is locked after the first voting identity.',
        );
      const opensAt = dto.votingOpensAt
        ? new Date(dto.votingOpensAt)
        : before.votingOpensAt;
      const closesAt = dto.votingClosesAt
        ? new Date(dto.votingClosesAt)
        : before.votingClosesAt;
      if (!opensAt || !closesAt || opensAt >= closesAt)
        fail(
          400,
          'INVALID_VOTING_WINDOW',
          'Voting opensAt must precede closesAt.',
        );
      const after = await tx.event.update({
        where: { id: eventId },
        data: {
          votingAccessMode: mode,
          votingOpensAt: opensAt,
          votingClosesAt: closesAt,
        },
        select: {
          votingAccessMode: true,
          votingOpensAt: true,
          votingClosesAt: true,
        },
      });
      await this.audit.record(tx, {
        action: 'VOTING_CONFIG_CHANGED',
        entityType: 'Event',
        entityId: eventId,
        eventId,
        actorUserId: principal.userId,
        beforeState: {
          mode: before.votingAccessMode,
          opensAt: before.votingOpensAt?.toISOString() ?? null,
          closesAt: before.votingClosesAt?.toISOString() ?? null,
        },
        afterState: {
          mode: after.votingAccessMode,
          opensAt: after.votingOpensAt?.toISOString() ?? null,
          closesAt: after.votingClosesAt?.toISOString() ?? null,
        },
      });
      return after;
    });
  }

  async auditLog(
    eventId: string,
    principal: SessionPrincipal,
    query: VotingAuditQueryDto,
  ) {
    await this.access.organizer(principal, eventId);
    await this.event(this.db, eventId, false);
    const rows = await this.db.auditEvent.findMany({
      where: {
        eventId,
        action: {
          in: [
            'COMMUNITY_VOTE_CAST',
            'COMMUNITY_VOTE_FLAGGED',
            'PROJECT_COMMENT_POSTED',
            'PROJECT_COMMENT_HIDDEN',
            'VOTING_CONFIG_CHANGED',
            'EVENT_UPDATED',
          ],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.pageSize ?? 100,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorUserId: true,
        createdAt: true,
        beforeState: true,
        afterState: true,
        metadata: true,
      },
    });
    const descriptions: Record<string, string> = {
      COMMUNITY_VOTE_CAST: 'Community vote cast',
      COMMUNITY_VOTE_FLAGGED: 'Voting pattern flagged for organizer review',
      PROJECT_COMMENT_POSTED: 'Project comment posted',
      PROJECT_COMMENT_HIDDEN: 'Project comment hidden by an organizer',
      VOTING_CONFIG_CHANGED: 'Voting configuration changed',
      EVENT_UPDATED: 'Voting window changed through event settings',
    };
    return {
      items: rows
        .filter(
          (row) =>
            row.action !== 'EVENT_UPDATED' ||
            (typeof row.metadata === 'object' &&
              row.metadata !== null &&
              'fields' in row.metadata &&
              Array.isArray(row.metadata.fields) &&
              row.metadata.fields.some(
                (field) =>
                  field === 'votingOpensAt' || field === 'votingClosesAt',
              )),
        )
        .map((row) => ({ ...row, description: descriptions[row.action] })),
      nextCursor:
        rows.length === (query.pageSize ?? 100) ? rows.at(-1)!.id : null,
    };
  }
}
