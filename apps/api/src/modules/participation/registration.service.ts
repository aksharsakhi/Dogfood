import { Inject, Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  private open(event: Event): void {
    if (
      !['PUBLISHED', 'ACTIVE'].includes(event.status) ||
      event.visibility === 'PRIVATE'
    )
      fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    const now = this.clock.now();
    if (event.registrationOpensAt && now < event.registrationOpensAt)
      fail(409, 'REGISTRATION_CLOSED', 'Registration has not opened.');
    if (event.registrationClosesAt && now >= event.registrationClosesAt)
      fail(409, 'REGISTRATION_CLOSED', 'Registration has closed.');
  }
  async register(principal: SessionPrincipal, eventId: string) {
    return this.db
      .$transaction(async (tx) => {
        const event = await tx.event.findUnique({ where: { id: eventId } });
        if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
        this.open(event);
        const activeRole = await tx.eventMembership.findFirst({
          where: { eventId, userId: principal.userId, status: 'ACTIVE' },
        });
        if (activeRole && activeRole.role !== 'PARTICIPANT')
          fail(
            409,
            'ROLE_CONFLICT',
            'An active role in this event prevents registration.',
          );
        const participantRole = await tx.eventMembership.findUnique({
          where: {
            eventId_userId_role: {
              eventId,
              userId: principal.userId,
              role: 'PARTICIPANT',
            },
          },
        });
        if (participantRole?.status === 'SUSPENDED')
          fail(
            403,
            'FORBIDDEN',
            'Suspended participant membership cannot register.',
          );
        const prior = await tx.registration.findUnique({
          where: { eventId_userId: { eventId, userId: principal.userId } },
        });
        if (prior && prior.status !== 'WITHDRAWN')
          fail(409, 'ALREADY_REGISTERED', 'You are already registered.');
        const now = this.clock.now();
        const registration = prior
          ? await tx.registration.update({
              where: { id: prior.id },
              data: {
                status: 'APPROVED',
                withdrawnAt: null,
                registeredAt: now,
              },
            })
          : await tx.registration.create({
              data: {
                eventId,
                userId: principal.userId,
                status: 'APPROVED',
                registeredAt: now,
              },
            });
        await tx.eventMembership.upsert({
          where: {
            eventId_userId_role: {
              eventId,
              userId: principal.userId,
              role: 'PARTICIPANT',
            },
          },
          update: { status: 'ACTIVE' },
          create: {
            eventId,
            userId: principal.userId,
            role: 'PARTICIPANT',
            status: 'ACTIVE',
          },
        });
        await this.audit.record(tx, {
          action: 'REGISTRATION_CREATED',
          entityType: 'Registration',
          entityId: registration.id,
          eventId,
          actorUserId: principal.userId,
          beforeState: prior ? { status: prior.status } : undefined,
          afterState: { status: 'APPROVED' },
        });
        return registration;
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          fail(
            409,
            'ROLE_OR_REGISTRATION_CONFLICT',
            'Registration or event role conflicts with an existing record.',
          );
        throw error;
      });
  }
  async mine(principal: SessionPrincipal, eventId: string) {
    return this.db.registration.findUnique({
      where: { eventId_userId: { eventId, userId: principal.userId } },
    });
  }
  async withdraw(principal: SessionPrincipal, eventId: string) {
    return this.db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || !['PUBLISHED', 'ACTIVE'].includes(event.status))
        fail(409, 'REGISTRATION_CLOSED', 'Registration changes are closed.');
      const registration = await tx.registration.findUnique({
        where: { eventId_userId: { eventId, userId: principal.userId } },
      });
      if (!registration || registration.status === 'WITHDRAWN')
        fail(
          409,
          'INVALID_STATE_TRANSITION',
          'No active registration to withdraw.',
        );
      if (
        await tx.teamMember.findFirst({
          where: { eventId, userId: principal.userId, leftAt: null },
        })
      )
        fail(409, 'MUST_LEAVE_TEAM', 'Leave your team before withdrawing.');
      const after = await tx.registration.update({
        where: { id: registration.id },
        data: { status: 'WITHDRAWN', withdrawnAt: this.clock.now() },
      });
      await tx.eventMembership.updateMany({
        where: { eventId, userId: principal.userId, role: 'PARTICIPANT' },
        data: { status: 'REVOKED' },
      });
      await this.audit.record(tx, {
        action: 'REGISTRATION_WITHDRAWN',
        entityType: 'Registration',
        entityId: registration.id,
        eventId,
        actorUserId: principal.userId,
        beforeState: { status: registration.status },
        afterState: { status: 'WITHDRAWN' },
      });
      return after;
    });
  }
}
