import { Inject, Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { canonicalEmbedOrigins } from './embed-origins';
import {
  CreateEventDto,
  EventConfigurationDto,
  PrizeDto,
  TrackDto,
  UpdateEventDto,
  UpdatePrizeDto,
  UpdateTrackDto,
} from './event.dto';
const dateKeys = [
  'registrationOpensAt',
  'registrationClosesAt',
  'submissionOpensAt',
  'submissionClosesAt',
  'judgingOpensAt',
  'judgingClosesAt',
  'votingOpensAt',
  'votingClosesAt',
  'resultsPublishAt',
] as const;
const publicStatus = ['PUBLISHED', 'ACTIVE'] as const;
function eventData(dto: EventConfigurationDto): Prisma.EventUpdateInput {
  const data: Prisma.EventUpdateInput = {};
  for (const key of [
    'name',
    'shortDescription',
    'description',
    'rules',
    'eligibility',
    'timezone',
    'visibility',
    'galleryVisibility',
    'minTeamSize',
    'maxTeamSize',
  ] as const) {
    if (dto[key] !== undefined) Object.assign(data, { [key]: dto[key] });
  }
  for (const key of dateKeys)
    if (dto[key] !== undefined)
      Object.assign(data, {
        [key]: dto[key] === null ? null : new Date(dto[key]!),
      });
  return data;
}
function validateConfiguration(
  event: Pick<
    Event,
    | 'registrationOpensAt'
    | 'registrationClosesAt'
    | 'submissionOpensAt'
    | 'submissionClosesAt'
    | 'judgingOpensAt'
    | 'judgingClosesAt'
    | 'votingOpensAt'
    | 'votingClosesAt'
    | 'resultsPublishAt'
    | 'minTeamSize'
    | 'maxTeamSize'
    | 'timezone'
  >,
) {
  if (event.minTeamSize < 1 || event.maxTeamSize < event.minTeamSize)
    fail(400, 'INVALID_TEAM_SIZE', 'Team size bounds are invalid.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: event.timezone });
  } catch {
    fail(400, 'INVALID_TIMEZONE', 'Use a valid IANA timezone.');
  }
  for (const [start, end] of [
    ['registrationOpensAt', 'registrationClosesAt'],
    ['submissionOpensAt', 'submissionClosesAt'],
    ['judgingOpensAt', 'judgingClosesAt'],
    ['votingOpensAt', 'votingClosesAt'],
  ] as const) {
    if (event[start] && event[end] && event[start] >= event[end])
      fail(400, 'INVALID_EVENT_WINDOW', `${start} must precede ${end}.`);
  }
  if (
    event.submissionClosesAt &&
    event.judgingOpensAt &&
    event.submissionClosesAt > event.judgingOpensAt
  )
    fail(
      400,
      'INVALID_EVENT_WINDOW',
      'Judging cannot open before submissions close.',
    );
  if (
    event.judgingClosesAt &&
    event.resultsPublishAt &&
    event.judgingClosesAt > event.resultsPublishAt
  )
    fail(
      400,
      'INVALID_EVENT_WINDOW',
      'Results cannot publish before judging closes.',
    );
}
function eventSnapshot(event: Event) {
  return {
    name: event.name,
    slug: event.slug,
    status: event.status,
    visibility: event.visibility,
    galleryVisibility: event.galleryVisibility,
  };
}
@Injectable()
export class EventsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}
  async embedConfig(principal: SessionPrincipal, eventId: string) {
    if (!(await this.access.hasRole(principal, eventId, 'ORGANIZER')))
      fail(403, 'FORBIDDEN', 'Organizer access is required for this event.');
    const event = await this.db.event.findUnique({
      where: { id: eventId },
      select: { embedAllowedOrigins: true },
    });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    return { allowedOrigins: event.embedAllowedOrigins };
  }
  async updateEmbedConfig(
    principal: SessionPrincipal,
    eventId: string,
    allowedOrigins: unknown,
  ) {
    if (!(await this.access.hasRole(principal, eventId, 'ORGANIZER')))
      fail(403, 'FORBIDDEN', 'Organizer access is required for this event.');
    const canonical = canonicalEmbedOrigins(allowedOrigins);
    return this.db.$transaction(async (tx) => {
      const before = await tx.event.findUnique({
        where: { id: eventId },
        select: { embedAllowedOrigins: true },
      });
      if (!before) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
      await tx.event.update({
        where: { id: eventId },
        data: { embedAllowedOrigins: canonical },
      });
      await this.audit.record(tx, {
        action: 'EVENT_EMBED_CONFIG_CHANGED',
        entityType: 'Event',
        entityId: eventId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { allowedOrigins: before.embedAllowedOrigins },
        afterState: { allowedOrigins: canonical },
      });
      return { allowedOrigins: canonical };
    });
  }
  private async configurable(eventId: string): Promise<void> {
    const event = await this.db.event.findUnique({
      where: { id: eventId },
      select: { status: true },
    });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (['COMPLETED', 'ARCHIVED'].includes(event.status))
      fail(
        409,
        'INVALID_STATE_TRANSITION',
        'Completed events cannot be edited.',
      );
  }
  async create(principal: SessionPrincipal, dto: CreateEventDto) {
    if (!dto.name?.trim())
      fail(400, 'VALIDATION_ERROR', 'Event name is required.');
    const input = {
      ...eventData(dto),
      slug: dto.slug,
      name: dto.name.trim(),
      createdBy: { connect: { id: principal.userId } },
    } as Prisma.EventCreateInput;
    const candidate = {
      ...input,
      registrationOpensAt: dto.registrationOpensAt
        ? new Date(dto.registrationOpensAt)
        : null,
      registrationClosesAt: dto.registrationClosesAt
        ? new Date(dto.registrationClosesAt)
        : null,
      submissionOpensAt: dto.submissionOpensAt
        ? new Date(dto.submissionOpensAt)
        : null,
      submissionClosesAt: dto.submissionClosesAt
        ? new Date(dto.submissionClosesAt)
        : null,
      judgingOpensAt: dto.judgingOpensAt ? new Date(dto.judgingOpensAt) : null,
      judgingClosesAt: dto.judgingClosesAt
        ? new Date(dto.judgingClosesAt)
        : null,
      votingOpensAt: dto.votingOpensAt ? new Date(dto.votingOpensAt) : null,
      votingClosesAt: dto.votingClosesAt ? new Date(dto.votingClosesAt) : null,
      resultsPublishAt: dto.resultsPublishAt
        ? new Date(dto.resultsPublishAt)
        : null,
      minTeamSize: dto.minTeamSize ?? 1,
      maxTeamSize: dto.maxTeamSize ?? 5,
      timezone: dto.timezone ?? 'UTC',
    };
    validateConfiguration(candidate);
    try {
      return await this.db.$transaction(async (tx) => {
        const event = await tx.event.create({ data: input });
        await tx.eventMembership.create({
          data: {
            eventId: event.id,
            userId: principal.userId,
            role: 'ORGANIZER',
          },
        });
        await this.audit.record(tx, {
          action: 'EVENT_CREATED',
          entityType: 'Event',
          entityId: event.id,
          eventId: event.id,
          actorUserId: principal.userId,
          afterState: eventSnapshot(event),
        });
        return event;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'EVENT_SLUG_TAKEN', 'Event slug is already in use.');
      throw error;
    }
  }
  async list(principal: SessionPrincipal | null) {
    const publicWhere: Prisma.EventWhereInput = {
      visibility: 'PUBLIC',
      status: { in: [...publicStatus] },
    };
    const where: Prisma.EventWhereInput = principal
      ? this.access.isAdmin(principal)
        ? {}
        : {
            OR: [
              publicWhere,
              {
                memberships: {
                  some: { userId: principal.userId, status: 'ACTIVE' },
                },
              },
            ],
          }
      : publicWhere;
    return this.db.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async visible(
    eventId: string,
    principal: SessionPrincipal | null,
  ): Promise<Event> {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    if (
      [...publicStatus, 'COMPLETED', 'ARCHIVED'].includes(event.status) &&
      event.visibility !== 'PRIVATE'
    )
      return event;
    if (
      principal &&
      (this.access.isAdmin(principal) ||
        (await this.db.eventMembership.findFirst({
          where: { eventId, userId: principal.userId, status: 'ACTIVE' },
        })))
    )
      return event;
    fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
  }
  async update(
    principal: SessionPrincipal,
    eventId: string,
    dto: UpdateEventDto,
  ) {
    await this.access.organizer(principal, eventId);
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      if (!locked.length) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
      const before = await tx.event.findUnique({ where: { id: eventId } });
      if (!before) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
      if (['COMPLETED', 'ARCHIVED'].includes(before.status))
        fail(
          409,
          'INVALID_STATE_TRANSITION',
          'Completed events cannot be edited.',
        );
      if (
        before.status !== 'DRAFT' &&
        ((dto.minTeamSize !== undefined &&
          dto.minTeamSize !== before.minTeamSize) ||
          (dto.maxTeamSize !== undefined &&
            dto.maxTeamSize !== before.maxTeamSize))
      )
        fail(
          409,
          'INVALID_STATE_TRANSITION',
          'Team size limits are fixed after publication.',
        );
      const data = eventData(dto);
      const candidate = { ...before, ...data } as Event;
      validateConfiguration(candidate);
      if (candidate.name.trim().length === 0)
        fail(400, 'VALIDATION_ERROR', 'Event name is required.');
      const after = await tx.event.update({ where: { id: eventId }, data });
      await this.audit.record(tx, {
        action: 'EVENT_UPDATED',
        entityType: 'Event',
        entityId: eventId,
        eventId,
        actorUserId: principal.userId,
        beforeState: eventSnapshot(before),
        afterState: eventSnapshot(after),
        metadata: { fields: Object.keys(data) },
      });
      return after;
    });
  }
  async publish(principal: SessionPrincipal, eventId: string) {
    await this.access.organizer(principal, eventId);
    return this.db.$transaction(async (tx) => {
      const result = await tx.event.updateMany({
        where: { id: eventId, status: 'DRAFT' },
        data: { status: 'PUBLISHED' },
      });
      if (!result.count)
        fail(
          409,
          'INVALID_STATE_TRANSITION',
          'Only draft events can be published.',
        );
      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      await this.audit.record(tx, {
        action: 'EVENT_PUBLISHED',
        entityType: 'Event',
        entityId: eventId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { status: 'DRAFT' },
        afterState: { status: 'PUBLISHED' },
      });
      return event;
    });
  }
  async tracks(eventId: string, principal: SessionPrincipal | null) {
    await this.visible(eventId, principal);
    return this.db.track.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
  }
  async createTrack(
    principal: SessionPrincipal,
    eventId: string,
    dto: TrackDto,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    if (!dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Track name is required.');
    try {
      return await this.db.$transaction(async (tx) => {
        const track = await tx.track.create({
          data: {
            eventId,
            name: dto.name.trim(),
            slug: dto.slug,
            description: dto.description,
            maxSubmissions: dto.maxSubmissions,
          },
        });
        await this.audit.record(tx, {
          action: 'TRACK_CREATED',
          entityType: 'Track',
          entityId: track.id,
          eventId,
          actorUserId: principal.userId,
          afterState: { name: track.name, slug: track.slug },
        });
        return track;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'TRACK_SLUG_TAKEN', 'Track slug is already in use.');
      throw error;
    }
  }
  async updateTrack(
    principal: SessionPrincipal,
    eventId: string,
    trackId: string,
    dto: UpdateTrackDto,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    if (dto.name !== undefined && !dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Track name is required.');
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Track" WHERE id = ${trackId}::uuid AND "eventId" = ${eventId}::uuid FOR UPDATE`;
      if (!locked.length) fail(404, 'TRACK_NOT_FOUND', 'Track was not found.');
      const before = await tx.track.findFirst({
        where: { id: trackId, eventId },
      });
      if (!before) fail(404, 'TRACK_NOT_FOUND', 'Track was not found.');
      if (dto.maxSubmissions != null) {
        const used = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(DISTINCT s."projectId")::int AS count FROM "Submission" s
          JOIN "Project" p ON p.id = s."projectId"
          WHERE p."eventId" = ${eventId}::uuid AND s."trackId" = ${trackId}::uuid
            AND s.status IN ('SUBMITTED', 'LOCKED')`;
        if ((used[0]?.count ?? 0) > dto.maxSubmissions)
          fail(
            409,
            'TRACK_LIMIT_TOO_LOW',
            'The limit is below existing submitted projects.',
          );
      }
      const after = await tx.track.update({
        where: { id: trackId },
        data: dto,
      });
      await this.audit.record(tx, {
        action: 'TRACK_UPDATED',
        entityType: 'Track',
        entityId: trackId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: before.name },
        afterState: { name: after.name },
      });
      return after;
    });
  }
  async deleteTrack(
    principal: SessionPrincipal,
    eventId: string,
    trackId: string,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    return this.db.$transaction(async (tx) => {
      const track = await tx.track.findFirst({
        where: { id: trackId, eventId },
      });
      if (!track) fail(404, 'TRACK_NOT_FOUND', 'Track was not found.');
      try {
        await tx.track.delete({ where: { id: trackId } });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2003'
        )
          fail(409, 'RESOURCE_IN_USE', 'Track is in use.');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'TRACK_DELETED',
        entityType: 'Track',
        entityId: trackId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: track.name, slug: track.slug },
      });
    });
  }
  async prizes(eventId: string, principal: SessionPrincipal | null) {
    await this.visible(eventId, principal);
    return this.db.prize.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
  }
  private async assertTrack(
    eventId: string,
    trackId: string | null | undefined,
  ): Promise<void> {
    if (
      trackId &&
      !(await this.db.track.findFirst({ where: { id: trackId, eventId } }))
    )
      fail(400, 'TRACK_NOT_FOUND', 'Track does not belong to this event.');
  }
  async createPrize(
    principal: SessionPrincipal,
    eventId: string,
    dto: PrizeDto,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    await this.assertTrack(eventId, dto.trackId);
    if (!dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Prize name is required.');
    if ((dto.amount === undefined) !== (dto.currency === undefined))
      fail(
        400,
        'INVALID_PRIZE',
        'Amount and currency must be provided together.',
      );
    if (!(await this.db.event.findUnique({ where: { id: eventId } })))
      fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    return this.db.$transaction(async (tx) => {
      const prize = await tx.prize.create({
        data: {
          eventId,
          name: dto.name.trim(),
          description: dto.description,
          trackId: dto.trackId,
          position: dto.position,
          amount: dto.amount,
          currency: dto.currency,
        },
      });
      await this.audit.record(tx, {
        action: 'PRIZE_CREATED',
        entityType: 'Prize',
        entityId: prize.id,
        eventId,
        actorUserId: principal.userId,
        afterState: { name: prize.name, trackId: prize.trackId },
      });
      return prize;
    });
  }
  async updatePrize(
    principal: SessionPrincipal,
    eventId: string,
    prizeId: string,
    dto: UpdatePrizeDto,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    await this.assertTrack(eventId, dto.trackId);
    if (dto.name !== undefined && !dto.name.trim())
      fail(400, 'VALIDATION_ERROR', 'Prize name is required.');
    return this.db.$transaction(async (tx) => {
      const before = await tx.prize.findFirst({
        where: { id: prizeId, eventId },
      });
      if (!before) fail(404, 'PRIZE_NOT_FOUND', 'Prize was not found.');
      const amount = dto.amount === undefined ? before.amount : dto.amount;
      const currency =
        dto.currency === undefined ? before.currency : dto.currency;
      if ((amount === null) !== (currency === null))
        fail(
          400,
          'INVALID_PRIZE',
          'Amount and currency must be provided together.',
        );
      const after = await tx.prize.update({
        where: { id: prizeId },
        data: { ...dto },
      });
      await this.audit.record(tx, {
        action: 'PRIZE_UPDATED',
        entityType: 'Prize',
        entityId: prizeId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: before.name },
        afterState: { name: after.name },
      });
      return after;
    });
  }
  async deletePrize(
    principal: SessionPrincipal,
    eventId: string,
    prizeId: string,
  ) {
    await this.access.organizer(principal, eventId);
    await this.configurable(eventId);
    return this.db.$transaction(async (tx) => {
      const prize = await tx.prize.findFirst({
        where: { id: prizeId, eventId },
      });
      if (!prize) fail(404, 'PRIZE_NOT_FOUND', 'Prize was not found.');
      await tx.prize.delete({ where: { id: prizeId } });
      await this.audit.record(tx, {
        action: 'PRIZE_DELETED',
        entityType: 'Prize',
        entityId: prizeId,
        eventId,
        actorUserId: principal.userId,
        beforeState: { name: prize.name },
      });
    });
  }
  async registrations(principal: SessionPrincipal, eventId: string) {
    await this.access.organizer(principal, eventId);
    return this.db.registration.findMany({
      where: { eventId },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, status: true },
        },
      },
      orderBy: { registeredAt: 'desc' },
      take: 500,
    });
  }
  async myMemberships(principal: SessionPrincipal, eventId: string) {
    return this.db.eventMembership.findMany({
      where: { eventId, userId: principal.userId, status: 'ACTIVE' },
      select: { role: true, status: true },
    });
  }
  async memberships(principal: SessionPrincipal, eventId: string) {
    await this.access.organizer(principal, eventId);
    return this.db.eventMembership.findMany({
      where: { eventId },
      select: {
        role: true,
        status: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }
}
