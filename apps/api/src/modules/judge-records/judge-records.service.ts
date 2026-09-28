import {
  HttpException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { AccessService } from '../../common/auth/access.service';
import { fail } from '../../common/errors/domain-error';
import { Clock } from '../../common/time';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AuditService } from '../audit/audit.service';
import {
  canonicalizePayload,
  signCanonicalPayload,
  signingKeyFromSeed,
  verifyCanonicalPayload,
  type JudgeRecordPayload,
  type JudgeRecordRevocationPayload,
  type SigningKeyMaterial,
} from './judge-records.crypto';
import {
  certificateHtml,
  judgeRecordCertificate,
  projectCertificate,
  registrationCertificate,
} from './certificate-html';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class JudgeRecordsService implements OnModuleInit {
  private readonly signingKey: SigningKeyMaterial;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {
    const seed = process.env.JUDGE_RECORD_SIGNING_KEY_SEED;
    if (!seed)
      throw new Error(
        'JUDGE_RECORD_SIGNING_KEY_SEED is required before the API can start.',
      );
    this.signingKey = signingKeyFromSeed(seed);
  }

  async onModuleInit(): Promise<void> {
    await this.registerSigningKey();
  }

  private async registerSigningKey(): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('dogfood_judge_record_signing_key'))::text AS lock_result`;
      const active = await tx.judgeRecordSigningKey.findFirst({
        where: { retiredAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const historical = await tx.judgeRecordSigningKey.findUnique({
        where: { id: this.signingKey.keyId },
      });
      if (
        historical &&
        (historical.fingerprint !== this.signingKey.fingerprint ||
          historical.publicKeyPem !== this.signingKey.publicKeyPem)
      )
        throw new Error(
          'Configured judge-record key ID conflicts with immutable published key material.',
        );
      if (active?.id === this.signingKey.keyId) return;

      const now = this.clock.now();
      if (active)
        await tx.judgeRecordSigningKey.update({
          where: { id: active.id },
          data: { retiredAt: now },
        });
      await tx.judgeRecordSigningKey.upsert({
        where: { id: this.signingKey.keyId },
        create: {
          id: this.signingKey.keyId,
          publicKeyPem: this.signingKey.publicKeyPem,
          fingerprint: this.signingKey.fingerprint,
          createdAt: now,
        },
        update: { retiredAt: null },
      });
      if (active && active.id !== this.signingKey.keyId) {
        const rotation = await tx.judgeRecordKeyRotation.create({
          data: {
            previousKeyId: active.id,
            activeKeyId: this.signingKey.keyId,
            previousFingerprint: active.fingerprint,
            activeFingerprint: this.signingKey.fingerprint,
            rotatedAt: now,
          },
        });
        await this.audit.record(tx, {
          action: 'JUDGE_RECORD_SIGNING_KEY_ROTATED',
          entityType: 'JudgeRecordKeyRotation',
          entityId: rotation.id,
        });
      }
    });
  }

  async publicKeys() {
    const keys = await this.db.judgeRecordSigningKey.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fingerprint: true,
        publicKeyPem: true,
        createdAt: true,
        retiredAt: true,
      },
    });
    const rotations = await this.db.judgeRecordKeyRotation.findMany({
      orderBy: [{ rotatedAt: 'asc' }, { id: 'asc' }],
      select: {
        previousKeyId: true,
        activeKeyId: true,
        previousFingerprint: true,
        activeFingerprint: true,
        rotatedAt: true,
      },
    });
    return {
      scheme: 'Ed25519',
      fingerprintAlgorithm: 'SHA-256 over the raw 32-byte Ed25519 public key',
      activeKeyId: this.signingKey.keyId,
      keys: keys.map((key) => ({
        ...key,
        active: key.id === this.signingKey.keyId,
      })),
      rotations,
    };
  }

  private async organizerForEvent(
    principal: SessionPrincipal,
    eventId: string,
  ): Promise<void> {
    await this.access.organizer(principal, eventId);
  }

  private async ownJudgeProfile(principal: SessionPrincipal, eventId: string) {
    const profile = await this.db.judgeProfile.findFirst({
      where: {
        eventMembership: {
          eventId,
          role: 'JUDGE',
          userId: principal.userId,
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    });
    if (!profile)
      fail(404, 'JUDGE_RECORD_NOT_FOUND', 'No judge record was found.');
    return profile;
  }

  private async counts(
    tx: Transaction,
    eventId: string,
    judgeProfileId: string,
  ) {
    const where = {
      eventId,
      judgeProfileId,
      status: { not: 'REVOKED' as const },
    };
    const [assignmentCount, evaluationCount] = await Promise.all([
      tx.judgeAssignment.count({ where }),
      tx.evaluation.count({
        where: {
          status: { in: ['SUBMITTED', 'LOCKED'] },
          submittedAt: { not: null },
          assignment: where,
        },
      }),
    ]);
    return { assignmentCount, evaluationCount };
  }

  async issue(
    principal: SessionPrincipal,
    eventId: string,
    judgeProfileId: string,
    supersedesRecordId?: string,
  ) {
    await this.organizerForEvent(principal, eventId);
    const judge = await this.db.judgeProfile.findFirst({
      where: {
        id: judgeProfileId,
        eventMembership: { eventId, role: 'JUDGE' },
      },
      select: { id: true },
    });
    if (!judge)
      fail(404, 'JUDGE_NOT_FOUND', 'Judge was not found for this event.');
    const event = await this.db.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');

    const recordId = randomUUID();
    const issuedAt = this.clock.now();
    try {
      return await this.db.$transaction(async (tx) => {
        let previous: { id: string } | null = null;
        if (supersedesRecordId) {
          previous = await tx.judgeParticipationRecord.findFirst({
            where: {
              id: supersedesRecordId,
              eventId,
              judgeProfileId,
              supersededBy: null,
            },
            select: { id: true },
          });
          if (!previous)
            fail(
              404,
              'JUDGE_RECORD_NOT_FOUND',
              'The record to correct was not found for this judge and event.',
            );
        }
        const subject = await tx.judgeRecordSubject.upsert({
          where: { eventId_judgeProfileId: { eventId, judgeProfileId } },
          create: { eventId, judgeProfileId },
          update: {},
          select: { id: true },
        });
        const { assignmentCount, evaluationCount } = await this.counts(
          tx,
          eventId,
          judgeProfileId,
        );
        const payload: JudgeRecordPayload = {
          schemaVersion: 1,
          recordId,
          eventId,
          subjectId: subject.id,
          assignmentCount,
          evaluationCount,
          issuedAt: issuedAt.toISOString(),
          issuerKeyId: this.signingKey.keyId,
          ...(previous ? { supersedesRecordId: previous.id } : {}),
        };
        const canonicalPayload = canonicalizePayload(payload);
        const signature = signCanonicalPayload(
          canonicalPayload,
          this.signingKey.privateKey,
        );
        const record = await tx.judgeParticipationRecord.create({
          data: {
            id: recordId,
            eventId,
            judgeProfileId,
            subjectId: subject.id,
            assignmentCount,
            evaluationCount,
            schemaVersion: payload.schemaVersion,
            issuedAt,
            issuerKeyId: this.signingKey.keyId,
            canonicalPayload,
            signature,
            supersedesRecordId: previous?.id,
          },
          select: { id: true, issuedAt: true },
        });
        await this.audit.record(tx, {
          action: 'JUDGE_PARTICIPATION_RECORD_ISSUED',
          entityType: 'JudgeParticipationRecord',
          entityId: record.id,
          eventId,
          actorUserId: principal.userId,
        });
        return {
          ...record,
          payload,
          signature,
          issuerKeyId: this.signingKey.keyId,
          fingerprint: this.signingKey.fingerprint,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(
          409,
          'RECORD_ALREADY_SUPERSEDED',
          'A correction already exists for the selected record.',
        );
      throw error;
    }
  }

  async listForOrganizer(principal: SessionPrincipal, eventId: string) {
    await this.organizerForEvent(principal, eventId);
    const records = await this.db.judgeParticipationRecord.findMany({
      where: { eventId },
      include: {
        revocation: { select: { revokedAt: true } },
        supersededBy: { select: { id: true } },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    });
    return records.map((record) => ({
      id: record.id,
      judgeProfileId: record.judgeProfileId,
      assignmentCount: record.assignmentCount,
      evaluationCount: record.evaluationCount,
      issuedAt: record.issuedAt,
      issuerKeyId: record.issuerKeyId,
      supersedesRecordId: record.supersedesRecordId,
      status: record.revocation
        ? 'REVOKED'
        : record.supersededBy
          ? 'SUPERSEDED'
          : 'ACTIVE',
      supersededByRecordId: record.supersededBy?.id ?? null,
    }));
  }

  async ownRecords(principal: SessionPrincipal, eventId: string) {
    const judge = await this.ownJudgeProfile(principal, eventId);
    return this.recordsForJudge(eventId, judge.id);
  }

  private async recordsForJudge(eventId: string, judgeProfileId: string) {
    const records = await this.db.judgeParticipationRecord.findMany({
      where: { eventId, judgeProfileId },
      include: {
        revocation: { select: { revokedAt: true } },
        supersededBy: { select: { id: true } },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    });
    return records.map((record) => ({
      id: record.id,
      eventId,
      assignmentCount: record.assignmentCount,
      evaluationCount: record.evaluationCount,
      issuedAt: record.issuedAt,
      status: record.revocation
        ? 'REVOKED'
        : record.supersededBy
          ? 'SUPERSEDED'
          : 'ACTIVE',
    }));
  }

  async revoke(principal: SessionPrincipal, eventId: string, recordId: string) {
    await this.organizerForEvent(principal, eventId);
    const revokedAt = this.clock.now();
    try {
      return await this.db.$transaction(async (tx) => {
        const record = await tx.judgeParticipationRecord.findFirst({
          where: { id: recordId, eventId },
          select: { id: true },
        });
        if (!record)
          fail(404, 'JUDGE_RECORD_NOT_FOUND', 'Judge record was not found.');
        const payload: JudgeRecordRevocationPayload = {
          schemaVersion: 1,
          statementType: 'judge-record-revocation',
          recordId,
          revokedAt: revokedAt.toISOString(),
          issuerKeyId: this.signingKey.keyId,
        };
        const canonicalPayload = canonicalizePayload(payload);
        const signature = signCanonicalPayload(
          canonicalPayload,
          this.signingKey.privateKey,
        );
        const revocation = await tx.judgeRecordRevocation.create({
          data: {
            recordId,
            issuerKeyId: this.signingKey.keyId,
            revokedAt,
            canonicalPayload,
            signature,
          },
          select: { id: true, revokedAt: true },
        });
        await this.audit.record(tx, {
          action: 'JUDGE_PARTICIPATION_RECORD_REVOKED',
          entityType: 'JudgeRecordRevocation',
          entityId: revocation.id,
          eventId,
          actorUserId: principal.userId,
        });
        return { ...revocation, recordId, issuerKeyId: this.signingKey.keyId };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'RECORD_ALREADY_REVOKED', 'Judge record is already revoked.');
      throw error;
    }
  }

  async verify(recordId: string) {
    const record = await this.db.judgeParticipationRecord.findUnique({
      where: { id: recordId },
      include: {
        issuerKey: {
          select: { id: true, fingerprint: true, publicKeyPem: true },
        },
        supersededBy: { select: { id: true } },
        revocation: {
          include: {
            issuerKey: { select: { fingerprint: true, publicKeyPem: true } },
          },
        },
      },
    });
    if (!record)
      fail(404, 'JUDGE_RECORD_NOT_FOUND', 'Judge record was not found.');
    const signatureValid = verifyCanonicalPayload(
      record.canonicalPayload,
      record.signature,
      record.issuerKey.publicKeyPem,
    );
    const payload: unknown = JSON.parse(record.canonicalPayload);
    const revocationSignatureValid = record.revocation
      ? verifyCanonicalPayload(
          record.revocation.canonicalPayload,
          record.revocation.signature,
          record.revocation.issuerKey.publicKeyPem,
        )
      : null;
    return {
      signatureValid,
      status: record.revocation
        ? 'REVOKED'
        : record.supersededBy
          ? 'SUPERSEDED'
          : 'ACTIVE',
      payload,
      canonicalPayload: record.canonicalPayload,
      signature: record.signature,
      publicKey: {
        keyId: record.issuerKeyId,
        fingerprint: record.issuerKey.fingerprint,
        publicKeyPem: record.issuerKey.publicKeyPem,
      },
      supersededByRecordId: record.supersededBy?.id ?? null,
      revocation: record.revocation
        ? {
            payload: JSON.parse(record.revocation.canonicalPayload),
            canonicalPayload: record.revocation.canonicalPayload,
            signature: record.revocation.signature,
            signatureValid: revocationSignatureValid,
          }
        : null,
    };
  }

  async judgeRecordHtml(
    principal: SessionPrincipal,
    eventId: string,
    recordId: string,
  ): Promise<string> {
    const record = await this.db.judgeParticipationRecord.findFirst({
      where: { id: recordId, eventId },
      select: { judgeProfileId: true },
    });
    if (!record)
      fail(404, 'JUDGE_RECORD_NOT_FOUND', 'Judge record was not found.');
    const isOrganizer =
      this.access.isAdmin(principal) ||
      (await this.access.hasRole(principal, eventId, 'ORGANIZER'));
    if (!isOrganizer) {
      const profile = await this.ownJudgeProfile(principal, eventId);
      if (profile.id !== record.judgeProfileId)
        fail(404, 'JUDGE_RECORD_NOT_FOUND', 'Judge record was not found.');
    }
    const verified = await this.verify(recordId);
    if (!verified.signatureValid)
      fail(
        500,
        'JUDGE_RECORD_SIGNATURE_INVALID',
        'Stored judge record failed signature verification.',
      );
    return judgeRecordCertificate({
      recordId,
      payload: verified.payload as Record<string, string | number>,
      canonicalPayload: verified.canonicalPayload,
      signature: verified.signature,
      publicKeyPem: verified.publicKey.publicKeyPem,
      fingerprint: verified.publicKey.fingerprint,
      status: verified.status,
      supersededByRecordId: verified.supersededByRecordId ?? undefined,
      revokedAt: verified.revocation
        ? String(
            (verified.revocation.payload as Record<string, unknown>).revokedAt,
          )
        : undefined,
    });
  }

  private async assertAccountAccess(
    principal: SessionPrincipal,
    eventId: string,
    userId: string,
  ) {
    if (principal.userId !== userId)
      await this.organizerForEvent(principal, eventId);
  }

  async registrationHtml(
    principal: SessionPrincipal,
    eventId: string,
    userId: string,
  ) {
    await this.assertAccountAccess(principal, eventId, userId);
    const registration = await this.db.registration.findUnique({
      where: { eventId_userId: { eventId, userId } },
      include: {
        event: { select: { id: true, name: true } },
        user: { select: { displayName: true } },
      },
    });
    if (
      !registration ||
      !['APPROVED', 'WITHDRAWN'].includes(registration.status)
    )
      fail(
        404,
        'REGISTRATION_RECORD_NOT_FOUND',
        'Registration record was not found.',
      );
    return registrationCertificate({
      eventName: registration.event.name,
      eventId: registration.event.id,
      displayName: registration.user.displayName,
      status: registration.status,
      registeredAt: registration.registeredAt,
    });
  }

  private async projectParticipationHtml(
    eventId: string,
    projectId: string,
    userId: string,
  ) {
    const project = await this.db.project.findFirst({
      where: { id: projectId, eventId },
      include: {
        event: { select: { id: true, name: true } },
        team: {
          include: {
            members: {
              where: { userId },
              select: { joinedAt: true, leftAt: true },
            },
          },
        },
        submissions: {
          where: {
            status: { in: ['SUBMITTED', 'LOCKED'] },
            submittedAt: { not: null },
          },
          orderBy: [{ submittedAt: 'desc' }, { version: 'desc' }],
          take: 1,
        },
      },
    });
    const snapshot = project?.submissions[0];
    const submittedAt = snapshot?.submittedAt;
    const member = project?.team.members.find(
      (candidate) =>
        submittedAt &&
        candidate.joinedAt <= submittedAt &&
        (!candidate.leftAt || candidate.leftAt >= submittedAt),
    );
    if (!project || !snapshot || !submittedAt || !member)
      fail(
        404,
        'PROJECT_PARTICIPATION_NOT_FOUND',
        'A matching team membership and submitted snapshot were not found.',
      );
    const account = await this.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    if (!account) fail(404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
    return projectCertificate({
      eventName: project.event.name,
      eventId: project.event.id,
      projectName: snapshot.projectName ?? project.name,
      teamName: project.team.name,
      snapshotTitle: snapshot.title,
      snapshotDescription: snapshot.description,
      repositoryUrl: snapshot.repositoryUrl,
      submittedAt,
      accountLabel: account.displayName,
    });
  }

  async ownProjectParticipationHtml(
    principal: SessionPrincipal,
    eventId: string,
  ) {
    const projects = await this.db.project.findMany({
      where: {
        eventId,
        team: { members: { some: { userId: principal.userId } } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const certificates: string[] = [];
    for (const project of projects) {
      try {
        certificates.push(
          await this.projectParticipationHtml(
            eventId,
            project.id,
            principal.userId,
          ),
        );
      } catch (error) {
        if (error instanceof HttpException) {
          const body: unknown = error.getResponse();
          if (
            body &&
            typeof body === 'object' &&
            'code' in body &&
            body.code === 'PROJECT_PARTICIPATION_NOT_FOUND'
          )
            continue;
        }
        throw error;
      }
    }
    if (!certificates.length)
      fail(
        404,
        'PROJECT_PARTICIPATION_NOT_FOUND',
        'No submitted team project record was found.',
      );
    const bodies = certificates.map((html) =>
      (html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? '').replace(
        /<button class="print"[\s\S]*?<\/button>/g,
        '',
      ),
    );
    return certificateHtml(
      'Project participation records',
      bodies.join('<hr>'),
    );
  }

  async projectParticipantHtml(
    principal: SessionPrincipal,
    eventId: string,
    projectId: string,
    userId: string,
  ) {
    await this.assertAccountAccess(principal, eventId, userId);
    return this.projectParticipationHtml(eventId, projectId, userId);
  }
}
