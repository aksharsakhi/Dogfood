import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { AuditService } from '../audit/audit.service';
import { fail } from '../../common/errors/domain-error';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  EVENT_FIELDS,
  MODEL_FIELDS,
  manifestFor,
  packageHash,
  type ArchiveEntities,
  type ArchiveModel,
  type ArchiveRow,
  type EventArchive,
} from './archive-format';
import { planArchive, REFS, type ArchivePlan } from './archive-plan';
import { semanticNormalize } from './archive-normalize';

type DynamicDelegate = {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  findUnique(args: object): Promise<Record<string, unknown> | null>;
  create(args: object): Promise<Record<string, unknown>>;
  update(args: object): Promise<Record<string, unknown>>;
};
type Db = DatabaseService | Prisma.TransactionClient;
const delegate = (db: Db, model: string): DynamicDelegate =>
  (db as unknown as Record<string, DynamicDelegate>)[
    model[0]!.toLowerCase() + model.slice(1)
  ]!;
const jsonRow = (row: unknown): ArchiveRow =>
  JSON.parse(JSON.stringify(row)) as ArchiveRow;
const selected = (fields: readonly string[]) =>
  Object.fromEntries(fields.map((field) => [field, true]));

function scopedWhere(model: ArchiveModel, eventId: string): object {
  switch (model) {
    case 'Submission':
      return { project: { eventId } };
    case 'JudgeProfile':
      return { eventMembership: { eventId } };
    case 'JudgeExpertise':
    case 'JudgeConflict':
      return { judgeProfile: { eventMembership: { eventId } } };
    case 'RubricCriterion':
      return { rubric: { eventId } };
    case 'AssignmentRunProposal':
      return { run: { eventId } };
    case 'Evaluation':
      return { assignment: { eventId } };
    case 'EvaluationScore':
      return { evaluation: { assignment: { eventId } } };
    case 'NormalizedScore':
    case 'ProjectScore':
    case 'JudgeScoreStats':
      return { scoreRun: { eventId } };
    case 'ProjectResult':
      return { resultRun: { eventId } };
    case 'JudgeRecordRevocation':
      return { record: { eventId } };
    default:
      return { eventId };
  }
}

const keyFor = (model: string, row: ArchiveRow) =>
  model === 'JudgeExpertise'
    ? `${row.judgeProfileId}:${row.trackId}`
    : String(row.id);

function decodedRow(model: string, row: ArchiveRow): ArchiveRow {
  const data = { ...row };
  const fields =
    Prisma.dmmf.datamodel.models.find((item) => item.name === model)?.fields ??
    [];
  for (const field of fields) {
    const value = data[field.name];
    if (value === null && field.type === 'Json')
      data[field.name] = Prisma.DbNull;
    else if (value !== null && value !== undefined && field.type === 'DateTime')
      data[field.name] = new Date(String(value));
    else if (value !== null && value !== undefined && field.type === 'Decimal')
      data[field.name] = new Prisma.Decimal(String(value));
  }
  return data;
}

function replaceNestedIds(
  value: unknown,
  flatIds: Record<string, string>,
): unknown {
  if (typeof value === 'string') return flatIds[value] ?? value;
  if (Array.isArray(value))
    return value.map((item) => replaceNestedIds(item, flatIds));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceNestedIds(item, flatIds),
      ]),
    );
  return value;
}

@Injectable()
export class EventArchiveService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async export(
    principal: SessionPrincipal,
    eventId: string,
  ): Promise<EventArchive> {
    await this.access.organizer(principal, eventId);
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event was not found.');
    const instance = await this.db.eventArchiveInstance.findUniqueOrThrow({
      where: { singleton: 1 },
    });
    const entities = {} as ArchiveEntities;
    for (const model of Object.keys(MODEL_FIELDS) as ArchiveModel[]) {
      if (
        model === 'JudgeRecordSigningKey' ||
        model === 'JudgeRecordKeyRotation'
      ) {
        entities[model] = [];
        continue;
      }
      const rows = await delegate(this.db, model).findMany({
        where: scopedWhere(model, eventId),
        select: selected(MODEL_FIELDS[model]),
      });
      entities[model] = rows
        .map(jsonRow)
        .sort((a, b) => keyFor(model, a).localeCompare(keyFor(model, b)));
    }
    const keyIds = new Set<string>();
    for (const row of entities.JudgeParticipationRecord)
      keyIds.add(String(row.issuerKeyId));
    for (const row of entities.JudgeRecordRevocation)
      keyIds.add(String(row.issuerKeyId));
    if (keyIds.size) {
      const rotations = await this.db.judgeRecordKeyRotation.findMany({
        where: {
          OR: [
            { previousKeyId: { in: [...keyIds] } },
            { activeKeyId: { in: [...keyIds] } },
          ],
        },
        select: {
          id: true,
          previousKeyId: true,
          activeKeyId: true,
          previousFingerprint: true,
          activeFingerprint: true,
          rotatedAt: true,
        },
      });
      entities.JudgeRecordKeyRotation = rotations
        .map(jsonRow)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const rotation of rotations) {
        keyIds.add(rotation.previousKeyId);
        keyIds.add(rotation.activeKeyId);
      }
      entities.JudgeRecordSigningKey = (
        await this.db.judgeRecordSigningKey.findMany({
          where: { id: { in: [...keyIds] } },
          select: selected(MODEL_FIELDS.JudgeRecordSigningKey),
        })
      )
        .map(jsonRow)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    const userIds = new Set<string>([event.createdById]);
    for (const model of Object.keys(entities) as ArchiveModel[])
      for (const row of entities[model])
        for (const [field, target] of Object.entries(REFS[model] ?? {}))
          if (target === 'User' && typeof row[field] === 'string')
            userIds.add(row[field]);
    const users = (
      await this.db.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, displayName: true },
      })
    ).sort((a, b) => a.id.localeCompare(b.id));
    if (users.length !== userIds.size)
      fail(500, 'ARCHIVE_INTEGRITY', 'Event references a missing account.');

    const liveCounts = await this.db.communityVote.groupBy({
      by: ['projectId'],
      where: { eventId },
      _count: { _all: true },
    });
    const importedCounts = await this.db.importedVoteAggregate.findMany({
      where: { eventId },
      select: { projectId: true, count: true },
    });
    const totals = new Map<string, number>();
    for (const row of liveCounts)
      totals.set(
        row.projectId,
        (totals.get(row.projectId) ?? 0) + row._count._all,
      );
    for (const row of importedCounts)
      totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + row.count);
    const voteAggregates = [...totals]
      .map(([projectId, count]) => ({ projectId, count }))
      .sort((a, b) => a.projectId.localeCompare(b.projectId));
    const currentComments = await this.db.projectComment.findMany({
      where: { eventId },
      select: {
        id: true,
        projectId: true,
        body: true,
        status: true,
        createdAt: true,
        hiddenAt: true,
      },
    });
    const importedComments = await this.db.importedProjectComment.findMany({
      where: { eventId },
      select: {
        id: true,
        projectId: true,
        body: true,
        status: true,
        createdAt: true,
        hiddenAt: true,
      },
    });
    const comments = [...currentComments, ...importedComments]
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        body: row.body,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        hiddenAt: row.hiddenAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const payload: EventArchive['payload'] = {
      event: Object.fromEntries(
        [...EVENT_FIELDS, 'embedAllowedOrigins'].map((field) => [
          field,
          jsonRow(event)[field],
        ]),
      ),
      users,
      entities,
      voteAggregates,
      comments,
    };
    const unsigned = {
      format: ARCHIVE_FORMAT,
      schemaVersion: ARCHIVE_VERSION,
      source: { instanceId: instance.id, eventId },
      exportedAt: new Date().toISOString(),
      manifest: manifestFor(payload),
      payload,
    };
    const archive: EventArchive = {
      ...unsigned,
      packageHash: packageHash(unsigned),
    };
    await this.db.$transaction(async (tx) =>
      this.audit.record(tx, {
        action: 'EVENT_EXPORTED',
        entityType: 'Event',
        entityId: eventId,
        eventId,
        actorUserId: principal.userId,
        metadata: {
          packageHash: archive.packageHash,
          totalRows: archive.manifest.totalRows,
        },
      }),
    );
    return archive;
  }

  async preview(principal: SessionPrincipal, input: unknown) {
    const plan = planArchive(input);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.db.$transaction(async (tx) => {
      await tx.eventArchivePreview.create({
        data: {
          actorUserId: principal.userId,
          packageHash: plan.archive.packageHash,
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        action: 'EVENT_IMPORT_PREVIEWED',
        entityType: 'EventArchive',
        actorUserId: principal.userId,
        metadata: {
          sourceInstanceId: plan.archive.source.instanceId,
          sourceEventId: plan.archive.source.eventId,
          packageHash: plan.archive.packageHash,
          totalRows: plan.archive.manifest.totalRows,
        },
      });
    });
    return {
      packageHash: plan.archive.packageHash,
      source: plan.archive.source,
      counts: plan.counts,
      identityMappings: Object.entries(plan.ids.User ?? {}).map(
        ([sourceId, placeholderId]) => ({
          sourceId,
          placeholderId,
          treatment: 'DEACTIVATED_UNCLAIMED',
        }),
      ),
      idRemapping: plan.ids,
      warnings: plan.warnings,
      privacyConsequences: plan.privacyConsequences,
      validationErrors: [],
      expiresAt,
    };
  }

  async confirm(
    principal: SessionPrincipal,
    input: unknown,
    confirmedHash: string,
  ) {
    const plan = planArchive(input);
    if (plan.archive.packageHash !== confirmedHash)
      fail(
        409,
        'ARCHIVE_CHANGED',
        'Package changed after preview; run dry-run again.',
      );
    const preview = await this.db.eventArchivePreview.findFirst({
      where: {
        actorUserId: principal.userId,
        packageHash: confirmedHash,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!preview)
      fail(
        409,
        'ARCHIVE_PREVIEW_REQUIRED',
        'Run dry-run for this exact package first.',
      );
    const prior = await this.db.eventArchiveImport.findUnique({
      where: {
        sourceInstanceId_sourceEventId_packageHash: {
          sourceInstanceId: plan.archive.source.instanceId,
          sourceEventId: plan.archive.source.eventId,
          packageHash: confirmedHash,
        },
      },
    });
    if (prior)
      return {
        status: 'ALREADY_IMPORTED',
        eventId: prior.destinationEventId,
        importId: prior.id,
        packageHash: confirmedHash,
      };
    try {
      return await this.db.$transaction(
        async (tx) => this.importInTransaction(tx, principal, plan),
        { timeout: 180_000, maxWait: 30_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.db.eventArchiveImport.findUnique({
          where: {
            sourceInstanceId_sourceEventId_packageHash: {
              sourceInstanceId: plan.archive.source.instanceId,
              sourceEventId: plan.archive.source.eventId,
              packageHash: confirmedHash,
            },
          },
        });
        if (raced)
          return {
            status: 'ALREADY_IMPORTED',
            eventId: raced.destinationEventId,
            importId: raced.id,
            packageHash: confirmedHash,
          };
      }
      throw error;
    }
  }

  private async importInTransaction(
    tx: Prisma.TransactionClient,
    principal: SessionPrincipal,
    plan: ArchivePlan,
  ) {
    const { archive, ids } = plan;
    const entities = archive.payload.entities;
    const sourceEventId = archive.source.eventId;
    const eventId = ids.Event![sourceEventId]!;
    const flatIds: Record<string, string> = {};
    for (const map of Object.values(ids))
      for (const [source, destination] of Object.entries(map))
        if (!source.includes(':')) flatIds[source] = destination;
    const importRow = async (
      model: ArchiveModel,
      source: ArchiveRow,
      extra: ArchiveRow = {},
    ) => {
      const row = { ...source };
      if (model !== 'JudgeExpertise')
        row.id = ids[model]![keyFor(model, source)];
      for (const [field, target] of Object.entries(REFS[model] ?? {})) {
        const value = row[field];
        if (typeof value === 'string') row[field] = ids[target]![value];
      }
      for (const field of [
        'parameters',
        'coverageDiagnostics',
        'normalizationDiagnostics',
        'coverageSnapshot',
        'previewStats',
      ]) {
        if (row[field] !== null && row[field] !== undefined)
          row[field] = replaceNestedIds(row[field], flatIds);
      }
      Object.assign(row, extra);
      return delegate(tx, model).create({ data: decodedRow(model, row) });
    };
    const sourceUserIds = Object.keys(ids.User!);
    for (const user of archive.payload.users) {
      const placeholderId = ids.User![user.id]!;
      await tx.user.create({
        data: {
          id: placeholderId,
          email: `imported-${placeholderId}@archive.invalid`,
          displayName: user.displayName,
          passwordHash: null,
          status: 'DEACTIVATED',
          importedPlaceholder: true,
          emailVerifiedAt: null,
        },
      });
    }
    const sourceEvent = archive.payload.event;
    await tx.event.create({
      data: decodedRow('Event', {
        ...sourceEvent,
        id: eventId,
        slug: `import-${archive.packageHash.slice(0, 20)}`,
        createdById: principal.userId,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        galleryVisibility: 'HIDDEN',
        embedAllowedOrigins: sourceEvent.embedAllowedOrigins ?? [],
      }) as Prisma.EventUncheckedCreateInput,
    });
    await tx.eventMembership.create({
      data: { eventId, userId: principal.userId, role: 'ORGANIZER' },
    });

    const ordinaryOrder: ArchiveModel[] = [
      'EventMembership',
      'Track',
      'Prize',
      'Registration',
      'Team',
      'TeamMember',
      'Project',
      'Submission',
      'JudgeProfile',
      'JudgeExpertise',
      'JudgeConflict',
    ];
    for (const model of ordinaryOrder)
      for (const row of entities[model]) await importRow(model, row);

    for (const rubric of entities.Rubric) {
      await importRow('Rubric', rubric, { status: 'DRAFT' });
      for (const criterion of entities.RubricCriterion.filter(
        (row) => row.rubricId === rubric.id,
      ))
        await importRow('RubricCriterion', criterion);
      if (rubric.status !== 'DRAFT')
        await tx.rubric.update({
          where: { id: ids.Rubric![String(rubric.id)]! },
          data: { status: rubric.status as 'PUBLISHED' | 'RETIRED' },
        });
    }
    for (const run of entities.AssignmentRun) {
      await importRow('AssignmentRun', run, {
        status: 'PREVIEW',
        publishedAt: null,
      });
      for (const proposal of entities.AssignmentRunProposal.filter(
        (row) => row.runId === run.id,
      ))
        await importRow('AssignmentRunProposal', proposal);
      if (run.status !== 'PREVIEW')
        await tx.assignmentRun.update({
          where: { id: ids.AssignmentRun![String(run.id)]! },
          data: {
            status: run.status as 'PUBLISHED' | 'SUPERSEDED',
            publishedAt:
              run.status === 'PUBLISHED'
                ? new Date(String(run.publishedAt))
                : null,
          },
        });
    }
    for (const row of entities.JudgeAssignment)
      await importRow('JudgeAssignment', row);
    for (const evaluation of entities.Evaluation) {
      await importRow('Evaluation', evaluation, { status: 'IN_PROGRESS' });
      for (const score of entities.EvaluationScore.filter(
        (row) => row.evaluationId === evaluation.id,
      ))
        await importRow('EvaluationScore', score);
      if (evaluation.status !== 'IN_PROGRESS')
        await tx.evaluation.update({
          where: { id: ids.Evaluation![String(evaluation.id)]! },
          data: {
            status: evaluation.status as 'NOT_STARTED' | 'SUBMITTED' | 'LOCKED',
          },
        });
    }
    for (const run of entities.ScoreRun) {
      const inputIds = entities.NormalizedScore.filter(
        (row) => row.scoreRunId === run.id,
      )
        .map((row) => String(row.evaluationId))
        .sort();
      const sourceHash = createHash('sha256')
        .update(inputIds.join(','))
        .digest('hex')
        .slice(0, 32);
      if (run.status === 'COMPLETED' && run.inputSetHash !== sourceHash)
        fail(
          400,
          'ARCHIVE_DERIVED_STATE',
          'Source score input hash is inconsistent.',
        );
      const destinationHash = createHash('sha256')
        .update(
          inputIds
            .map((id) => ids.Evaluation![id]!)
            .sort()
            .join(','),
        )
        .digest('hex')
        .slice(0, 32);
      await importRow('ScoreRun', run, { inputSetHash: destinationHash });
    }
    for (const model of [
      'NormalizedScore',
      'ProjectScore',
      'JudgeScoreStats',
      'ResultRun',
      'ProjectResult',
    ] as ArchiveModel[])
      for (const row of entities[model]) await importRow(model, row);

    for (const key of entities.JudgeRecordSigningKey) {
      const existing = await tx.judgeRecordSigningKey.findUnique({
        where: { id: String(key.id) },
      });
      if (existing) {
        if (
          existing.publicKeyPem !== key.publicKeyPem ||
          existing.fingerprint !== key.fingerprint
        )
          fail(
            400,
            'ARCHIVE_SIGNATURE',
            'Source key ID conflicts with destination key.',
          );
      } else {
        await importRow('JudgeRecordSigningKey', key, {
          retiredAt: key.retiredAt ?? new Date().toISOString(),
        });
      }
    }
    for (const model of [
      'JudgeRecordKeyRotation',
      'JudgeRecordSubject',
    ] as ArchiveModel[])
      for (const row of entities[model]) await importRow(model, row);
    const pending = [...entities.JudgeParticipationRecord];
    while (pending.length) {
      const index = pending.findIndex(
        (row) =>
          row.supersedesRecordId === null ||
          !pending.some((candidate) => candidate.id === row.supersedesRecordId),
      );
      if (index < 0)
        fail(400, 'ARCHIVE_REFERENCE', 'Judge record supersession cycle.');
      const [row] = pending.splice(index, 1);
      await importRow('JudgeParticipationRecord', row!, {
        sourceInstanceId: row!.sourceInstanceId ?? archive.source.instanceId,
        sourceEventId: row!.sourceEventId ?? archive.source.eventId,
        sourceRecordId: row!.sourceRecordId ?? row!.id,
      });
    }
    for (const row of entities.JudgeRecordRevocation)
      await importRow('JudgeRecordRevocation', row);
    for (const row of entities.WebhookSubscription)
      await importRow('WebhookSubscription', row, {
        active: false,
        secretCiphertext: null,
        secretIv: null,
        secretAuthTag: null,
      });
    for (const aggregate of archive.payload.voteAggregates)
      await tx.importedVoteAggregate.create({
        data: {
          eventId,
          projectId: ids.Project![aggregate.projectId]!,
          count: aggregate.count,
        },
      });
    for (const comment of archive.payload.comments) {
      const authorId = ids.CommentAuthor![comment.id]!;
      await tx.user.create({
        data: {
          id: authorId,
          email: `imported-${authorId}@archive.invalid`,
          displayName: 'Imported commenter',
          passwordHash: null,
          status: 'DEACTIVATED',
          importedPlaceholder: true,
        },
      });
      await tx.importedProjectComment.create({
        data: {
          id: ids.CommentAuthor![comment.id]!,
          eventId,
          projectId: ids.Project![comment.projectId]!,
          authorUserId: authorId,
          body: comment.body,
          status: comment.status as 'VISIBLE' | 'HIDDEN',
          createdAt: new Date(comment.createdAt),
          hiddenAt: comment.hiddenAt ? new Date(comment.hiddenAt) : null,
        },
      });
    }
    const archiveImport = await tx.eventArchiveImport.create({
      data: {
        sourceInstanceId: archive.source.instanceId,
        sourceEventId,
        packageHash: archive.packageHash,
        destinationEventId: eventId,
        importedById: principal.userId,
      },
    });
    const mapRows = Object.entries(ids).flatMap(([model, map]) =>
      Object.entries(map).map(([sourceId, destinationId]) => ({
        importId: archiveImport.id,
        model,
        sourceId,
        destinationId,
      })),
    );
    await tx.eventArchiveEntityMap.createMany({ data: mapRows });
    await this.audit.record(tx, {
      action: 'EVENT_IMPORTED',
      entityType: 'Event',
      entityId: eventId,
      eventId,
      actorUserId: principal.userId,
      metadata: {
        sourceInstanceId: archive.source.instanceId,
        sourceEventId,
        packageHash: archive.packageHash,
        totalRows: archive.manifest.totalRows,
        placeholderCount: sourceUserIds.length,
      },
    });
    return {
      status: 'IMPORTED',
      eventId,
      importId: archiveImport.id,
      packageHash: archive.packageHash,
    };
  }

  semanticNormalize = semanticNormalize;
}
