import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { hashToken, normalizeEmail } from '../identity/auth.service';
import {
  ConflictDto,
  JudgeInviteDto,
  JudgeProfileDto,
  RubricDto,
} from './judging.dto';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async invite(p: SessionPrincipal, eventId: string, dto: JudgeInviteDto) {
    await this.access.organizer(p, eventId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      this.clock.now().getTime() + (dto.expiresInHours ?? 168) * 3600000,
    );
    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    if (dto.invitedUserId && email) {
      const intended = await this.db.user.findUnique({
        where: { id: dto.invitedUserId },
      });
      if (!intended || intended.email !== email)
        fail(400, 'INVITEE_MISMATCH', 'Recipient ID and email do not match.');
    }
    const invite = await this.db.$transaction(async (tx) => {
      const created = await tx.judgeInvitation.create({
        data: {
          eventId,
          invitedUserId: dto.invitedUserId,
          email,
          tokenHash: hashToken(token),
          expiresAt,
          createdById: p.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'JUDGE_INVITED',
        entityType: 'JudgeInvitation',
        entityId: created.id,
        eventId,
        actorUserId: p.userId,
        metadata: {
          invitedUserId: dto.invitedUserId ?? null,
          email: email ?? null,
          expiresAt: expiresAt.toISOString(),
        },
      });
      return created;
    });
    return { id: invite.id, eventId, expiresAt, token };
  }

  async invitations(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.judgeInvitation.findMany({
      where: { eventId },
      select: {
        id: true,
        email: true,
        invitedUserId: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        respondedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(p: SessionPrincipal, eventId: string, invitationId: string) {
    await this.access.organizer(p, eventId);
    await this.db.$transaction(async (tx) => {
      const changed = await tx.judgeInvitation.updateMany({
        where: { id: invitationId, eventId, status: 'PENDING' },
        data: { status: 'REVOKED', respondedAt: this.clock.now() },
      });
      if (!changed.count)
        fail(404, 'INVITATION_NOT_FOUND', 'Pending invitation not found.');
      await this.audit.record(tx, {
        action: 'JUDGE_INVITE_REVOKED',
        entityType: 'JudgeInvitation',
        entityId: invitationId,
        eventId,
        actorUserId: p.userId,
      });
    });
  }

  async accept(p: SessionPrincipal, token: string) {
    const invitation = await this.db.judgeInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invitation)
      fail(404, 'INVITATION_NOT_FOUND', 'Invitation is invalid.');
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: p.userId },
    });
    if (
      (invitation.invitedUserId && invitation.invitedUserId !== p.userId) ||
      (invitation.email && invitation.email !== user.email)
    )
      fail(
        403,
        'INVITATION_RECIPIENT_MISMATCH',
        'This invitation belongs to another user.',
      );
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${invitation.eventId}::uuid FOR UPDATE`;
        const changed = await tx.judgeInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'PENDING',
            expiresAt: { gt: this.clock.now() },
          },
          data: { status: 'ACCEPTED', respondedAt: this.clock.now() },
        });
        if (!changed.count)
          fail(
            409,
            'INVITATION_UNAVAILABLE',
            'Invitation has expired or was already used or revoked.',
          );
        const memberships = await tx.eventMembership.findMany({
          where: {
            eventId: invitation.eventId,
            userId: p.userId,
            status: 'ACTIVE',
          },
        });
        if (memberships.some((m) => m.role !== 'JUDGE'))
          fail(
            409,
            'ROLE_CONFLICT',
            'A different active event role already exists.',
          );
        let membership = await tx.eventMembership.findUnique({
          where: {
            eventId_userId_role: {
              eventId: invitation.eventId,
              userId: p.userId,
              role: 'JUDGE',
            },
          },
        });
        if (!membership)
          membership = await tx.eventMembership.create({
            data: {
              eventId: invitation.eventId,
              userId: p.userId,
              role: 'JUDGE',
            },
          });
        else if (membership.status !== 'ACTIVE')
          membership = await tx.eventMembership.update({
            where: { id: membership.id },
            data: { status: 'ACTIVE' },
          });
        const profile = await tx.judgeProfile.upsert({
          where: { eventMembershipId: membership.id },
          create: { eventMembershipId: membership.id },
          update: {},
        });
        await this.audit.record(tx, {
          action: 'JUDGE_ACCEPTED',
          entityType: 'JudgeProfile',
          entityId: profile.id,
          eventId: invitation.eventId,
          actorUserId: p.userId,
          metadata: { invitationId: invitation.id },
        });
        return { eventId: invitation.eventId, judgeProfileId: profile.id };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'ROLE_CONFLICT', 'An active event role already exists.');
      throw error;
    }
  }

  async judges(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    const rows = await this.db.judgeProfile.findMany({
      where: { eventMembership: { eventId } },
      include: {
        eventMembership: {
          select: {
            userId: true,
            status: true,
            user: { select: { displayName: true, email: true } },
          },
        },
        expertise: { select: { trackId: true } },
      },
    });
    return rows.map((j) => ({
      id: j.id,
      userId: j.eventMembership.userId,
      displayName: j.eventMembership.user.displayName,
      email: j.eventMembership.user.email,
      membershipStatus: j.eventMembership.status,
      available: j.available,
      maxAssignments: j.maxAssignments,
      bio: j.bio,
      organization: j.organization,
      trackIds: j.expertise.map((x) => x.trackId),
    }));
  }

  async profile(
    p: SessionPrincipal,
    eventId: string,
    profileId: string,
    dto: JudgeProfileDto,
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      const profile = await tx.judgeProfile.findFirst({
        where: { id: profileId, eventMembership: { eventId, role: 'JUDGE' } },
      });
      if (!profile) fail(404, 'JUDGE_NOT_FOUND', 'Judge not found.');
      if (dto.trackIds) {
        const ids = [...new Set(dto.trackIds)];
        if (
          (await tx.track.count({ where: { eventId, id: { in: ids } } })) !==
          ids.length
        )
          fail(
            400,
            'TRACK_MISMATCH',
            'All expertise tracks must belong to this event.',
          );
        await tx.judgeExpertise.deleteMany({
          where: { judgeProfileId: profileId },
        });
        if (ids.length)
          await tx.judgeExpertise.createMany({
            data: ids.map((trackId) => ({
              judgeProfileId: profileId,
              trackId,
              expertiseLevel: 3,
            })),
          });
      }
      const changed = await tx.judgeProfile.update({
        where: { id: profileId },
        data: {
          ...(dto.maxAssignments !== undefined
            ? { maxAssignments: dto.maxAssignments }
            : {}),
          ...(dto.available !== undefined ? { available: dto.available } : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.organization !== undefined
            ? { organization: dto.organization }
            : {}),
        },
      });
      return {
        id: changed.id,
        maxAssignments: changed.maxAssignments,
        available: changed.available,
        bio: changed.bio,
        organization: changed.organization,
      };
    });
  }

  async conflicts(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.judgeConflict.findMany({
      where: { judgeProfile: { eventMembership: { eventId } } },
      select: {
        id: true,
        judgeProfileId: true,
        type: true,
        teamId: true,
        projectId: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  async declareConflict(
    p: SessionPrincipal,
    eventId: string,
    dto: ConflictDto,
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      const judge = await tx.judgeProfile.findFirst({
        where: {
          id: dto.judgeProfileId,
          eventMembership: { eventId, role: 'JUDGE' },
        },
      });
      if (!judge) fail(404, 'JUDGE_NOT_FOUND', 'Judge not found.');
      const valid =
        dto.type === 'TEAM'
          ? await tx.team.count({ where: { id: dto.targetId, eventId } })
          : await tx.project.count({ where: { id: dto.targetId, eventId } });
      if (!valid)
        fail(
          404,
          'CONFLICT_TARGET_NOT_FOUND',
          'Conflict target not found in this event.',
        );
      const conflict = await tx.judgeConflict.create({
        data: {
          judgeProfileId: dto.judgeProfileId,
          type: dto.type,
          ...(dto.type === 'TEAM'
            ? { teamId: dto.targetId }
            : { projectId: dto.targetId }),
          reason: dto.reason,
        },
      });
      await this.audit.record(tx, {
        action: 'CONFLICT_DECLARED',
        entityType: 'JudgeConflict',
        entityId: conflict.id,
        eventId,
        actorUserId: p.userId,
        metadata: {
          judgeProfileId: dto.judgeProfileId,
          type: dto.type,
          targetId: dto.targetId,
        },
      });
      return {
        id: conflict.id,
        judgeProfileId: conflict.judgeProfileId,
        type: conflict.type,
        teamId: conflict.teamId,
        projectId: conflict.projectId,
        reason: conflict.reason,
      };
    });
  }

  async removeConflict(
    p: SessionPrincipal,
    eventId: string,
    conflictId: string,
  ) {
    await this.access.organizer(p, eventId);
    await this.db.$transaction(async (tx) => {
      const conflict = await tx.judgeConflict.findFirst({
        where: {
          id: conflictId,
          judgeProfile: { eventMembership: { eventId } },
        },
      });
      if (!conflict) fail(404, 'CONFLICT_NOT_FOUND', 'Conflict not found.');
      await tx.judgeConflict.delete({ where: { id: conflictId } });
      await this.audit.record(tx, {
        action: 'CONFLICT_REMOVED',
        entityType: 'JudgeConflict',
        entityId: conflictId,
        eventId,
        actorUserId: p.userId,
      });
    });
  }

  async rubrics(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.rubric.findMany({
      where: { eventId },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { version: 'desc' },
    });
  }

  private criterionData(dto: RubricDto, rubricId: string) {
    if (
      dto.criteria.length > 30 ||
      new Set(dto.criteria.map((c) => c.name.trim().toLowerCase())).size !==
        dto.criteria.length
    )
      fail(
        400,
        'INVALID_RUBRIC',
        'Use at most 30 criteria with distinct names.',
      );
    return dto.criteria.map((c, displayOrder) => {
      const weight = new Prisma.Decimal(c.weight);
      const minScore = new Prisma.Decimal(c.minScore);
      const maxScore = new Prisma.Decimal(c.maxScore);
      if (weight.lte(0) || minScore.gte(maxScore))
        fail(
          400,
          'INVALID_RUBRIC',
          'Criterion weight and score bounds are invalid.',
        );
      return {
        rubricId,
        name: c.name.trim(),
        description: c.description,
        weight,
        minScore,
        maxScore,
        displayOrder,
      };
    });
  }

  async createRubric(p: SessionPrincipal, eventId: string, dto: RubricDto) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const latest = await tx.rubric.findFirst({
        where: { eventId },
        orderBy: { version: 'desc' },
      });
      const rubric = await tx.rubric.create({
        data: {
          eventId,
          name: dto.name.trim(),
          version: (latest?.version ?? 0) + 1,
        },
      });
      await tx.rubricCriterion.createMany({
        data: this.criterionData(dto, rubric.id),
      });
      await this.audit.record(tx, {
        action: 'RUBRIC_CREATED',
        entityType: 'Rubric',
        entityId: rubric.id,
        eventId,
        actorUserId: p.userId,
        metadata: { version: rubric.version },
      });
      return tx.rubric.findUniqueOrThrow({
        where: { id: rubric.id },
        include: { criteria: { orderBy: { displayOrder: 'asc' } } },
      });
    });
  }

  async updateRubric(
    p: SessionPrincipal,
    eventId: string,
    rubricId: string,
    dto: RubricDto,
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Rubric" WHERE id = ${rubricId}::uuid FOR UPDATE`;
      const rubric = await tx.rubric.findFirst({
        where: { id: rubricId, eventId, status: 'DRAFT' },
      });
      if (!rubric)
        fail(409, 'RUBRIC_IMMUTABLE', 'Only draft rubrics can be edited.');
      const data = this.criterionData(dto, rubricId);
      await tx.rubricCriterion.deleteMany({ where: { rubricId } });
      await tx.rubricCriterion.createMany({ data });
      await tx.rubric.update({
        where: { id: rubricId },
        data: { name: dto.name.trim() },
      });
      return tx.rubric.findUniqueOrThrow({
        where: { id: rubricId },
        include: { criteria: { orderBy: { displayOrder: 'asc' } } },
      });
    });
  }

  async publishRubric(p: SessionPrincipal, eventId: string, rubricId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Rubric" WHERE id = ${rubricId}::uuid FOR UPDATE`;
      const rubric = await tx.rubric.findFirst({
        where: { id: rubricId, eventId },
        include: { criteria: true },
      });
      if (!rubric) fail(404, 'RUBRIC_NOT_FOUND', 'Rubric not found.');
      if (rubric.status !== 'DRAFT')
        fail(
          409,
          'RUBRIC_IMMUTABLE',
          'Rubric is already published or retired.',
        );
      const total = rubric.criteria.reduce(
        (sum, c) => sum.plus(c.weight),
        new Prisma.Decimal(0),
      );
      if (!rubric.criteria.length || !total.eq(1))
        fail(
          400,
          'INVALID_RUBRIC_WEIGHTS',
          'Criterion weights must total exactly 1.',
        );
      const updated = await tx.rubric.update({
        where: { id: rubricId },
        data: { status: 'PUBLISHED', publishedAt: this.clock.now() },
        include: { criteria: { orderBy: { displayOrder: 'asc' } } },
      });
      await this.audit.record(tx, {
        action: 'RUBRIC_PUBLISHED',
        entityType: 'Rubric',
        entityId: rubricId,
        eventId,
        actorUserId: p.userId,
        metadata: { version: rubric.version },
      });
      return updated;
    });
  }
}
