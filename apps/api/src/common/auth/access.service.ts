import { Inject, Injectable } from '@nestjs/common';
import { EventRole } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { fail } from '../errors/domain-error';
@Injectable()
export class AccessService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  isAdmin(principal: SessionPrincipal): boolean {
    return principal.platformRoles.includes('ADMIN');
  }
  async hasRole(
    principal: SessionPrincipal,
    eventId: string,
    role: EventRole,
  ): Promise<boolean> {
    return (
      (
        await this.db.eventMembership.findUnique({
          where: {
            eventId_userId_role: { eventId, userId: principal.userId, role },
          },
          select: { status: true },
        })
      )?.status === 'ACTIVE'
    );
  }
  async organizer(principal: SessionPrincipal, eventId: string): Promise<void> {
    if (
      this.isAdmin(principal) ||
      (await this.hasRole(principal, eventId, 'ORGANIZER'))
    )
      return;
    fail(403, 'FORBIDDEN', 'Organizer access is required for this event.');
  }
  async participant(
    principal: SessionPrincipal,
    eventId: string,
  ): Promise<void> {
    if (await this.hasRole(principal, eventId, 'PARTICIPANT')) return;
    fail(403, 'FORBIDDEN', 'Active participant membership is required.');
  }
  async teamMember(
    principal: SessionPrincipal,
    eventId: string,
    teamId: string,
    ownerOnly = false,
  ) {
    await this.participant(principal, eventId);
    const member = await this.db.teamMember.findFirst({
      where: {
        teamId,
        eventId,
        userId: principal.userId,
        leftAt: null,
        team: { status: { in: ['FORMING', 'ACTIVE'] } },
      },
    });
    if (!member || (ownerOnly && member.role !== 'OWNER'))
      fail(
        403,
        'FORBIDDEN',
        ownerOnly
          ? 'Team owner access is required.'
          : 'Active team membership is required.',
      );
    return member;
  }
}
