import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Team } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { hashToken, normalizeEmail } from '../identity/auth.service';
import { CreateTeamDto, InviteDto, UpdateTeamDto } from './team.dto';

const userFields = { id: true, email: true, displayName: true } as const;
@Injectable()
export class TeamService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  private async eventAllowsChanges(
    tx: Prisma.TransactionClient,
    eventId: string,
  ): Promise<{ minTeamSize: number; maxTeamSize: number }> {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (
      !['PUBLISHED', 'ACTIVE'].includes(event.status) ||
      (event.submissionClosesAt && this.clock.now() >= event.submissionClosesAt)
    )
      fail(409, 'TEAM_CHANGES_CLOSED', 'Team changes are closed.');
    return event;
  }
  private async lockTeam(
    tx: Prisma.TransactionClient,
    eventId: string,
    teamId: string,
    principal?: SessionPrincipal,
    ownerOnly = false,
  ): Promise<Team> {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Team" WHERE id = ${teamId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
    if (!rows.length) fail(404, 'TEAM_NOT_FOUND', 'Team was not found.');
    if (principal) await this.member(tx, teamId, principal.userId, ownerOnly);
    const team = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
    if (!['FORMING', 'ACTIVE'].includes(team.status))
      fail(409, 'TEAM_LOCKED', 'This team cannot be changed.');
    if (
      await tx.submission.count({
        where: { project: { teamId }, status: { in: ['SUBMITTED', 'LOCKED'] } },
      })
    )
      fail(409, 'TEAM_LOCKED', 'A submitted project locks this team roster.');
    return team;
  }
  private async member(
    tx: Prisma.TransactionClient,
    teamId: string,
    userId: string,
    ownerOnly = false,
  ) {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { eventId: true },
    });
    if (
      !team ||
      !(await tx.eventMembership.findFirst({
        where: {
          eventId: team.eventId,
          userId,
          role: 'PARTICIPANT',
          status: 'ACTIVE',
        },
      }))
    )
      fail(403, 'FORBIDDEN', 'Active participant membership is required.');
    const member = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || member.leftAt || (ownerOnly && member.role !== 'OWNER'))
      fail(
        403,
        'FORBIDDEN',
        ownerOnly
          ? 'Team owner access is required.'
          : 'Team membership is required.',
      );
    return member;
  }
  private async assertFree(
    tx: Prisma.TransactionClient,
    eventId: string,
    userId: string,
  ) {
    if (
      await tx.teamMember.findFirst({
        where: { eventId, userId, leftAt: null },
      })
    )
      fail(
        409,
        'ALREADY_ON_TEAM',
        'You already belong to a team in this event.',
      );
  }
  private async activeCount(tx: Prisma.TransactionClient, teamId: string) {
    return tx.teamMember.count({ where: { teamId, leftAt: null } });
  }
  private async syncStatus(
    tx: Prisma.TransactionClient,
    teamId: string,
    minTeamSize: number,
    count: number,
  ) {
    await tx.team.update({
      where: { id: teamId },
      data: { status: count >= minTeamSize ? 'ACTIVE' : 'FORMING' },
    });
  }
  async create(
    principal: SessionPrincipal,
    eventId: string,
    dto: CreateTeamDto,
  ) {
    await this.access.participant(principal, eventId);
    try {
      return await this.db.$transaction(async (tx) => {
        const event = await this.eventAllowsChanges(tx, eventId);
        await this.assertFree(tx, eventId, principal.userId);
        const team = await tx.team.create({
          data: {
            eventId,
            name: dto.name.trim(),
            slug: dto.slug,
            createdById: principal.userId,
            status: event.minTeamSize === 1 ? 'ACTIVE' : 'FORMING',
          },
        });
        await tx.teamMember.create({
          data: {
            teamId: team.id,
            eventId,
            userId: principal.userId,
            role: 'OWNER',
          },
        });
        await this.audit.record(tx, {
          action: 'TEAM_CREATED',
          entityType: 'Team',
          entityId: team.id,
          eventId,
          actorUserId: principal.userId,
          afterState: { name: team.name, slug: team.slug },
        });
        return team;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          409,
          'ALREADY_ON_TEAM_OR_SLUG_TAKEN',
          'You already belong to a team or the slug is taken.',
        );
      throw error;
    }
  }
  async mine(principal: SessionPrincipal, eventId: string) {
    const membership = await this.db.teamMember.findFirst({
      where: { eventId, userId: principal.userId, leftAt: null },
      select: { teamId: true },
    });
    return membership
      ? this.detail(principal, eventId, membership.teamId)
      : null;
  }
  async detail(principal: SessionPrincipal, eventId: string, teamId: string) {
    await this.access.teamMember(principal, eventId, teamId);
    return this.db.team.findFirst({
      where: { id: teamId, eventId },
      include: {
        members: {
          where: { leftAt: null },
          select: {
            id: true,
            userId: true,
            role: true,
            joinedAt: true,
            user: { select: userFields },
          },
        },
      },
    });
  }
  async rename(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
    dto: UpdateTeamDto,
  ) {
    if (!dto.name?.trim())
      fail(400, 'VALIDATION_ERROR', 'Team name is required.');
    return this.db.$transaction(async (tx) => {
      await this.eventAllowsChanges(tx, eventId);
      const team = await this.lockTeam(tx, eventId, teamId, principal, true);
      const after = await tx.team.update({
        where: { id: teamId },
        data: { name: dto.name.trim() },
      });
      await this.audit.record(tx, {
        action: 'TEAM_UPDATED',
        entityType: 'Team',
        entityId: teamId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: team.name },
        afterState: { name: after.name },
      });
      return after;
    });
  }
  async leave(principal: SessionPrincipal, eventId: string, teamId: string) {
    return this.db.$transaction(async (tx) => {
      const event = await this.eventAllowsChanges(tx, eventId);
      await this.lockTeam(tx, eventId, teamId, principal);
      const member = await this.member(tx, teamId, principal.userId);
      const count = await this.activeCount(tx, teamId);
      if (member.role === 'OWNER' && count > 1)
        fail(
          409,
          'OWNER_MUST_REMAIN',
          'Remove other members before the owner leaves.',
        );
      await tx.teamMember.update({
        where: { id: member.id },
        data: { leftAt: this.clock.now() },
      });
      await this.audit.record(tx, {
        action: 'TEAM_MEMBER_LEFT',
        entityType: 'TeamMember',
        entityId: member.id,
        eventId,
        actorUserId: principal.userId,
        beforeState: { role: member.role, active: true },
        afterState: { active: false },
      });
      if (member.role === 'OWNER') {
        await tx.team.update({
          where: { id: teamId },
          data: { status: 'DISBANDED' },
        });
        await tx.teamInvitation.updateMany({
          where: { teamId, status: 'PENDING' },
          data: { status: 'REVOKED', respondedAt: this.clock.now() },
        });
        await this.audit.record(tx, {
          action: 'TEAM_DISBANDED',
          entityType: 'Team',
          entityId: teamId,
          eventId,
          actorUserId: principal.userId,
          afterState: { status: 'DISBANDED' },
        });
      } else await this.syncStatus(tx, teamId, event.minTeamSize, count - 1);
    });
  }
  async remove(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
    userId: string,
  ) {
    if (principal.userId === userId)
      fail(409, 'INVALID_STATE_TRANSITION', 'Use leave to exit your team.');
    return this.db.$transaction(async (tx) => {
      const event = await this.eventAllowsChanges(tx, eventId);
      await this.lockTeam(tx, eventId, teamId, principal, true);
      const member = await this.member(tx, teamId, userId);
      if (member.role === 'OWNER')
        fail(409, 'OWNER_MUST_REMAIN', 'Owner cannot be removed.');
      await tx.teamMember.update({
        where: { id: member.id },
        data: { leftAt: this.clock.now() },
      });
      await this.syncStatus(
        tx,
        teamId,
        event.minTeamSize,
        await this.activeCount(tx, teamId),
      );
      await this.audit.record(tx, {
        action: 'TEAM_MEMBER_REMOVED',
        entityType: 'TeamMember',
        entityId: member.id,
        eventId,
        actorUserId: principal.userId,
        beforeState: { active: true },
        afterState: { active: false },
        metadata: { removedUserId: userId },
      });
    });
  }
  async invite(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
    dto: InviteDto,
  ) {
    const email = normalizeEmail(dto.email);
    return this.db.$transaction(async (tx) => {
      const event = await this.eventAllowsChanges(tx, eventId);
      await this.lockTeam(tx, eventId, teamId, principal, true);
      if ((await this.activeCount(tx, teamId)) >= event.maxTeamSize)
        fail(409, 'TEAM_FULL', 'This team is full.');
      const inviter = await tx.user.findUniqueOrThrow({
        where: { id: principal.userId },
      });
      if (inviter.email === email)
        fail(409, 'INVITATION_INVALID', 'You cannot invite yourself.');
      if (
        await tx.teamInvitation.findFirst({
          where: {
            teamId,
            email,
            status: 'PENDING',
            expiresAt: { gt: this.clock.now() },
          },
        })
      )
        fail(409, 'INVITATION_PENDING', 'A pending invitation already exists.');
      const token = randomBytes(32).toString('base64url');
      const invitation = await tx.teamInvitation.create({
        data: {
          teamId,
          email,
          tokenHash: hashToken(token),
          status: 'PENDING',
          expiresAt: new Date(
            this.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000,
          ),
          createdById: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'TEAM_INVITATION_CREATED',
        entityType: 'TeamInvitation',
        entityId: invitation.id,
        eventId,
        actorUserId: principal.userId,
        metadata: { recipientEmail: email },
      });
      return {
        id: invitation.id,
        teamId,
        email,
        expiresAt: invitation.expiresAt,
        token,
      };
    });
  }
  async invitations(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
  ) {
    await this.access.teamMember(principal, eventId, teamId, true);
    return this.db.teamInvitation.findMany({
      where: { teamId },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        respondedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async revoke(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
    invitationId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.eventAllowsChanges(tx, eventId);
      await this.lockTeam(tx, eventId, teamId, principal, true);
      const result = await tx.teamInvitation.updateMany({
        where: { id: invitationId, teamId, status: 'PENDING' },
        data: { status: 'REVOKED', respondedAt: this.clock.now() },
      });
      if (!result.count)
        fail(409, 'INVITATION_INVALID', 'Invitation is not pending.');
      await this.audit.record(tx, {
        action: 'TEAM_INVITATION_REVOKED',
        entityType: 'TeamInvitation',
        entityId: invitationId,
        eventId,
        actorUserId: principal.userId,
      });
    });
  }
  async preview(principal: SessionPrincipal, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      fail(404, 'INVITATION_INVALID', 'Invitation was not found.');
    const invitation = await this.db.teamInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { team: { include: { event: true } } },
    });
    if (!invitation)
      fail(404, 'INVITATION_INVALID', 'Invitation was not found.');
    if (
      invitation.status !== 'PENDING' ||
      invitation.expiresAt <= this.clock.now()
    )
      fail(
        409,
        'INVITATION_INVALID',
        'This invitation is no longer available.',
      );
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: principal.userId },
    });
    if (
      (invitation.email && invitation.email !== user.email) ||
      (invitation.invitedUserId &&
        invitation.invitedUserId !== principal.userId)
    )
      fail(403, 'INVITATION_INVALID', 'Invitation is for another user.');
    return {
      team: { id: invitation.team.id, name: invitation.team.name },
      event: {
        id: invitation.team.event.id,
        name: invitation.team.event.name,
        slug: invitation.team.event.slug,
        status: invitation.team.event.status,
      },
      expiresAt: invitation.expiresAt,
    };
  }
  private async respond(
    principal: SessionPrincipal,
    token: string,
    accept: boolean,
  ) {
    const tokenHash = hashToken(token);
    try {
      return await this.db.$transaction(async (tx) => {
        const found = await tx.teamInvitation.findUnique({
          where: { tokenHash },
          include: { team: true },
        });
        if (!found) fail(404, 'INVITATION_INVALID', 'Invitation is invalid.');
        const eventId = found.team.eventId;
        const event = await this.eventAllowsChanges(tx, eventId);
        await this.lockTeam(tx, eventId, found.teamId);
        const invitation = await tx.teamInvitation.findUniqueOrThrow({
          where: { id: found.id },
        });
        if (invitation.status !== 'PENDING')
          fail(409, 'INVITATION_INVALID', 'Invitation is no longer pending.');
        if (invitation.expiresAt <= this.clock.now())
          fail(409, 'INVITATION_EXPIRED', 'Invitation has expired.');
        const user = await tx.user.findUniqueOrThrow({
          where: { id: principal.userId },
        });
        if (
          (invitation.email && invitation.email !== user.email) ||
          (invitation.invitedUserId &&
            invitation.invitedUserId !== principal.userId)
        )
          fail(403, 'INVITATION_INVALID', 'Invitation is for another user.');
        if (accept) {
          const membership = await tx.eventMembership.findUnique({
            where: {
              eventId_userId_role: {
                eventId,
                userId: principal.userId,
                role: 'PARTICIPANT',
              },
            },
          });
          if (membership?.status !== 'ACTIVE')
            fail(
              403,
              'FORBIDDEN',
              'Active participant membership is required.',
            );
          await this.assertFree(tx, eventId, principal.userId);
          const count = await this.activeCount(tx, found.teamId);
          if (count >= event.maxTeamSize)
            fail(409, 'TEAM_FULL', 'This team is full.');
          const previous = await tx.teamMember.findUnique({
            where: {
              teamId_userId: { teamId: found.teamId, userId: principal.userId },
            },
          });
          if (previous)
            await tx.teamMember.update({
              where: { id: previous.id },
              data: {
                leftAt: null,
                joinedAt: this.clock.now(),
                role: 'MEMBER',
              },
            });
          else
            await tx.teamMember.create({
              data: {
                eventId,
                teamId: found.teamId,
                userId: principal.userId,
                role: 'MEMBER',
              },
            });
          await this.syncStatus(tx, found.teamId, event.minTeamSize, count + 1);
        }
        await tx.teamInvitation.update({
          where: { id: invitation.id },
          data: {
            status: accept ? 'ACCEPTED' : 'REJECTED',
            respondedAt: this.clock.now(),
          },
        });
        await this.audit.record(tx, {
          action: accept
            ? 'TEAM_INVITATION_ACCEPTED'
            : 'TEAM_INVITATION_REJECTED',
          entityType: 'TeamInvitation',
          entityId: invitation.id,
          eventId,
          actorUserId: principal.userId,
          afterState: { status: accept ? 'ACCEPTED' : 'REJECTED' },
        });
        return {
          status: accept ? 'ACCEPTED' : 'REJECTED',
          teamId: found.teamId,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          409,
          'ALREADY_ON_TEAM',
          'You already belong to a team in this event.',
        );
      throw error;
    }
  }
  accept(principal: SessionPrincipal, token: string) {
    return this.respond(principal, token, true);
  }
  reject(principal: SessionPrincipal, token: string) {
    return this.respond(principal, token, false);
  }
}
