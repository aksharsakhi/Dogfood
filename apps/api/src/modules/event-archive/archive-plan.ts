import { createHash, createPublicKey } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { verifyCanonicalPayload } from '../judge-records/judge-records.crypto';
import { fail } from '../../common/errors/domain-error';
import {
  type ArchiveModel,
  type ArchiveRow,
  type EventArchive,
  EVENT_FIELDS,
  MODEL_FIELDS,
  parseArchive,
  uuid,
} from './archive-format';

export const REFS: Partial<Record<ArchiveModel, Record<string, string>>> = {
  EventMembership: { eventId: 'Event', userId: 'User' },
  Track: { eventId: 'Event' },
  Prize: { eventId: 'Event', trackId: 'Track' },
  Registration: { eventId: 'Event', userId: 'User' },
  Team: { eventId: 'Event', createdById: 'User' },
  TeamMember: { eventId: 'Event', teamId: 'Team', userId: 'User' },
  Project: { eventId: 'Event', teamId: 'Team', trackId: 'Track' },
  Submission: { projectId: 'Project', trackId: 'Track', createdById: 'User' },
  JudgeProfile: { eventMembershipId: 'EventMembership' },
  JudgeExpertise: { judgeProfileId: 'JudgeProfile', trackId: 'Track' },
  JudgeConflict: {
    judgeProfileId: 'JudgeProfile',
    teamId: 'Team',
    projectId: 'Project',
  },
  Rubric: { eventId: 'Event' },
  RubricCriterion: { rubricId: 'Rubric' },
  AssignmentRun: {
    eventId: 'Event',
    rubricVersionId: 'Rubric',
    createdById: 'User',
  },
  AssignmentRunProposal: {
    runId: 'AssignmentRun',
    judgeProfileId: 'JudgeProfile',
    submissionId: 'Submission',
  },
  JudgeAssignment: {
    eventId: 'Event',
    runId: 'AssignmentRun',
    rubricId: 'Rubric',
    judgeProfileId: 'JudgeProfile',
    submissionId: 'Submission',
    assignedById: 'User',
  },
  Evaluation: { assignmentId: 'JudgeAssignment', rubricId: 'Rubric' },
  EvaluationScore: {
    evaluationId: 'Evaluation',
    criterionId: 'RubricCriterion',
  },
  ScoreRun: {
    eventId: 'Event',
    rubricVersionId: 'Rubric',
    createdById: 'User',
  },
  NormalizedScore: {
    scoreRunId: 'ScoreRun',
    evaluationId: 'Evaluation',
    judgeProfileId: 'JudgeProfile',
    submissionId: 'Submission',
    projectId: 'Project',
  },
  ProjectScore: { scoreRunId: 'ScoreRun', projectId: 'Project' },
  ResultRun: {
    eventId: 'Event',
    scoreRunId: 'ScoreRun',
    overrideActorId: 'User',
    createdById: 'User',
  },
  ProjectResult: { resultRunId: 'ResultRun', projectId: 'Project' },
  JudgeScoreStats: { scoreRunId: 'ScoreRun', judgeProfileId: 'JudgeProfile' },
  JudgeRecordKeyRotation: {
    previousKeyId: 'JudgeRecordSigningKey',
    activeKeyId: 'JudgeRecordSigningKey',
  },
  JudgeRecordSubject: { eventId: 'Event', judgeProfileId: 'JudgeProfile' },
  JudgeParticipationRecord: {
    eventId: 'Event',
    judgeProfileId: 'JudgeProfile',
    subjectId: 'JudgeRecordSubject',
    issuerKeyId: 'JudgeRecordSigningKey',
    supersedesRecordId: 'JudgeParticipationRecord',
  },
  JudgeRecordRevocation: {
    recordId: 'JudgeParticipationRecord',
    issuerKeyId: 'JudgeRecordSigningKey',
  },
  WebhookSubscription: { eventId: 'Event', createdById: 'User' },
};

export type IdPlan = Record<string, Record<string, string>>;
const modelKey = (model: string, row: ArchiveRow): string => {
  if (model === 'JudgeExpertise') return `${row.judgeProfileId}:${row.trackId}`;
  if (typeof row.id !== 'string')
    fail(400, 'ARCHIVE_INVALID', `${model} row needs an ID.`);
  return row.id;
};

export function deterministicId(hash: string, model: string, sourceId: string) {
  const bytes = createHash('sha256')
    .update(`dogfood-archive-v1:${hash}:${model}:${sourceId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validRowScalars(model: string, row: ArchiveRow) {
  const dmmf = Prisma.dmmf.datamodel.models.find(
    (candidate) => candidate.name === model,
  );
  if (!dmmf) fail(400, 'ARCHIVE_INVALID', 'Archive contains an unknown model.');
  const allowed =
    model === 'Event' ? EVENT_FIELDS : MODEL_FIELDS[model as ArchiveModel];
  for (const field of allowed) {
    const descriptor = dmmf.fields.find((item) => item.name === field);
    const value = row[field];
    if (!descriptor || value === undefined)
      fail(400, 'ARCHIVE_INVALID', `Missing ${model} field.`);
    if (value === null) {
      if (descriptor.isRequired)
        fail(400, 'ARCHIVE_INVALID', `Required ${model} field is null.`);
      continue;
    }
    if (descriptor.isList) {
      if (!Array.isArray(value) || value.length > 1000)
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} list field.`);
    } else if (descriptor.type === 'DateTime') {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} date.`);
    } else if (descriptor.type === 'Int' || descriptor.type === 'Float') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} number.`);
    } else if (descriptor.type === 'Boolean') {
      if (typeof value !== 'boolean')
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} boolean.`);
    } else if (descriptor.type === 'Decimal') {
      if (typeof value !== 'string' && typeof value !== 'number')
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} decimal.`);
    } else if (descriptor.kind === 'enum') {
      const allowed =
        Prisma.dmmf.datamodel.enums
          .find((item) => item.name === descriptor.type)
          ?.values.map((item) => item.name) ?? [];
      if (typeof value !== 'string' || !allowed.includes(value))
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} enum value.`);
    } else if (descriptor.type !== 'Json' && typeof value !== 'string') {
      fail(400, 'ARCHIVE_INVALID', `Invalid ${model} string.`);
    }
  }
}

export interface ArchivePlan {
  archive: EventArchive;
  ids: IdPlan;
  warnings: string[];
  privacyConsequences: string[];
  counts: Record<string, number>;
}

export function planArchive(input: unknown): ArchivePlan {
  const archive = parseArchive(input);
  const ids: IdPlan = { Event: {}, User: {}, CommentAuthor: {} };
  const event = archive.payload.event;
  validRowScalars('Event', event);
  ids.Event![archive.source.eventId] = deterministicId(
    archive.packageHash,
    'Event',
    archive.source.eventId,
  );
  if (ids.Event![archive.source.eventId] === archive.source.eventId)
    fail(400, 'ARCHIVE_INVALID', 'Destination event must differ from source.');

  for (const user of archive.payload.users) {
    if (!uuid(user.id) || !user.displayName.trim() || ids.User![user.id])
      fail(400, 'ARCHIVE_IDENTITY', 'Ambiguous or invalid source identity.');
    ids.User![user.id] = deterministicId(archive.packageHash, 'User', user.id);
  }
  if (!ids.User![String(event.createdById)])
    fail(
      400,
      'ARCHIVE_REFERENCE',
      'Event creator is missing from source users.',
    );
  for (const [start, end] of [
    ['registrationOpensAt', 'registrationClosesAt'],
    ['submissionOpensAt', 'submissionClosesAt'],
    ['judgingOpensAt', 'judgingClosesAt'],
    ['votingOpensAt', 'votingClosesAt'],
  ] as const) {
    if (
      event[start] &&
      event[end] &&
      Date.parse(String(event[start])) >= Date.parse(String(event[end]))
    )
      fail(400, 'ARCHIVE_INVALID', 'Event date window is invalid.');
  }

  for (const model of Object.keys(MODEL_FIELDS) as ArchiveModel[]) {
    ids[model] = {};
    for (const row of archive.payload.entities[model]) {
      validRowScalars(model, row);
      const key = modelKey(model, row);
      if (ids[model]![key])
        fail(400, 'ARCHIVE_INVALID', `Duplicate ${model} row.`);
      if (
        model !== 'JudgeRecordSigningKey' &&
        model !== 'JudgeExpertise' &&
        !uuid(key)
      )
        fail(400, 'ARCHIVE_INVALID', `Invalid ${model} ID.`);
      ids[model]![key] =
        model === 'JudgeRecordSigningKey'
          ? key
          : deterministicId(archive.packageHash, model, key);
    }
  }

  for (const model of Object.keys(MODEL_FIELDS) as ArchiveModel[]) {
    for (const row of archive.payload.entities[model]) {
      for (const [field, target] of Object.entries(REFS[model] ?? {})) {
        const value = row[field];
        if (
          value !== null &&
          (typeof value !== 'string' || !ids[target]?.[value])
        )
          fail(
            400,
            'ARCHIVE_REFERENCE',
            `${model} has an invalid ${field} reference.`,
          );
      }
      if ('eventId' in row && row.eventId !== archive.source.eventId)
        fail(
          400,
          'ARCHIVE_SCOPE',
          `${model} crosses the source event boundary.`,
        );
    }
  }
  const membershipById = new Map(
    archive.payload.entities.EventMembership.map((row) => [row.id, row]),
  );
  const activeRoles = new Set<string>();
  for (const row of archive.payload.entities.EventMembership) {
    if (row.status !== 'ACTIVE') continue;
    const key = String(row.userId);
    if (activeRoles.has(key))
      fail(
        400,
        'ARCHIVE_IDENTITY',
        'Source identity has ambiguous active event roles.',
      );
    activeRoles.add(key);
  }
  for (const row of archive.payload.entities.JudgeProfile)
    if (membershipById.get(row.eventMembershipId)?.role !== 'JUDGE')
      fail(400, 'ARCHIVE_REFERENCE', 'Judge profile lacks a judge membership.');
  const byId = (model: ArchiveModel) =>
    new Map(archive.payload.entities[model].map((row) => [row.id, row]));
  const rubrics = byId('Rubric');
  const runs = byId('AssignmentRun');
  const submissions = byId('Submission');
  const assignments = byId('JudgeAssignment');
  const evaluations = byId('Evaluation');
  const criteria = byId('RubricCriterion');
  for (const row of archive.payload.entities.AssignmentRun)
    if (rubrics.get(row.rubricVersionId)?.status !== 'PUBLISHED')
      fail(
        400,
        'ARCHIVE_REFERENCE',
        'Assignment run requires a published rubric.',
      );
  for (const row of archive.payload.entities.JudgeAssignment) {
    if (
      runs.get(row.runId)?.status !== 'PUBLISHED' ||
      runs.get(row.runId)?.rubricVersionId !== row.rubricId ||
      !['SUBMITTED', 'LOCKED'].includes(
        String(submissions.get(row.submissionId)?.status),
      )
    )
      fail(400, 'ARCHIVE_REFERENCE', 'Assignment has invalid frozen inputs.');
  }
  for (const row of archive.payload.entities.Evaluation)
    if (
      assignments.get(row.assignmentId)?.rubricId !== row.rubricId ||
      rubrics.get(row.rubricId)?.status !== 'PUBLISHED'
    )
      fail(
        400,
        'ARCHIVE_REFERENCE',
        'Evaluation does not match a published assignment rubric.',
      );
  for (const row of archive.payload.entities.EvaluationScore) {
    const evaluation = evaluations.get(row.evaluationId);
    const criterion = criteria.get(row.criterionId);
    if (
      !evaluation ||
      !criterion ||
      criterion.rubricId !== evaluation.rubricId ||
      Number(row.score) < Number(criterion.minScore) ||
      Number(row.score) > Number(criterion.maxScore)
    )
      fail(
        400,
        'ARCHIVE_REFERENCE',
        'Evaluation score is outside its rubric criterion.',
      );
  }
  for (const key of archive.payload.entities.JudgeRecordSigningKey) {
    try {
      const der = createPublicKey(String(key.publicKeyPem)).export({
        format: 'der',
        type: 'spki',
      });
      const fingerprint = createHash('sha256')
        .update(der.subarray(-32))
        .digest('hex');
      if (
        fingerprint !== key.fingerprint ||
        key.id !== `ed25519-sha256:${fingerprint}`
      )
        fail(
          400,
          'ARCHIVE_SIGNATURE',
          'Source signing-key fingerprint is invalid.',
        );
    } catch {
      fail(
        400,
        'ARCHIVE_SIGNATURE',
        'Source signing-key public material is invalid.',
      );
    }
  }
  for (const row of archive.payload.entities.JudgeParticipationRecord) {
    const key = archive.payload.entities.JudgeRecordSigningKey.find(
      (candidate) => candidate.id === row.issuerKeyId,
    );
    if (
      !key ||
      typeof row.canonicalPayload !== 'string' ||
      typeof row.signature !== 'string' ||
      typeof key.publicKeyPem !== 'string' ||
      !verifyCanonicalPayload(
        row.canonicalPayload,
        row.signature,
        key.publicKeyPem,
      )
    )
      fail(
        400,
        'ARCHIVE_SIGNATURE',
        'Historical judge record signature is invalid.',
      );
  }
  for (const row of archive.payload.entities.JudgeRecordRevocation) {
    const key = archive.payload.entities.JudgeRecordSigningKey.find(
      (candidate) => candidate.id === row.issuerKeyId,
    );
    if (
      !key ||
      typeof row.canonicalPayload !== 'string' ||
      typeof row.signature !== 'string' ||
      typeof key.publicKeyPem !== 'string' ||
      !verifyCanonicalPayload(
        row.canonicalPayload,
        row.signature,
        key.publicKeyPem,
      )
    )
      fail(
        400,
        'ARCHIVE_SIGNATURE',
        'Historical revocation signature is invalid.',
      );
  }
  const projectIds = ids.Project!;
  for (const row of archive.payload.voteAggregates) {
    if (
      !projectIds[row.projectId] ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    )
      fail(400, 'ARCHIVE_REFERENCE', 'Invalid privacy-safe vote aggregate.');
  }
  if (
    new Set(archive.payload.voteAggregates.map((row) => row.projectId)).size !==
    archive.payload.voteAggregates.length
  )
    fail(400, 'ARCHIVE_INVALID', 'Duplicate vote aggregate.');
  for (const row of archive.payload.comments) {
    if (
      !uuid(row.id) ||
      !projectIds[row.projectId] ||
      !['VISIBLE', 'HIDDEN'].includes(row.status) ||
      typeof row.body !== 'string' ||
      row.body.length > 2000 ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      (row.hiddenAt !== null && !Number.isFinite(Date.parse(row.hiddenAt))) ||
      ids.CommentAuthor![row.id]
    )
      fail(400, 'ARCHIVE_REFERENCE', 'Invalid imported comment.');
    ids.CommentAuthor![row.id] = deterministicId(
      archive.packageHash,
      'CommentAuthor',
      row.id,
    );
  }
  for (const row of archive.payload.entities.WebhookSubscription) {
    try {
      if (
        new URL(String(row.url)).protocol !== 'https:' ||
        !Array.isArray(row.eventTypes) ||
        row.eventTypes.some((value) => typeof value !== 'string')
      )
        fail(400, 'ARCHIVE_INVALID', 'Invalid portable webhook configuration.');
    } catch {
      fail(400, 'ARCHIVE_INVALID', 'Invalid portable webhook configuration.');
    }
  }
  for (const row of archive.payload.entities.ScoreRun) {
    if (row.status !== 'COMPLETED') continue;
    const evalIds = archive.payload.entities.NormalizedScore.filter(
      (item) => item.scoreRunId === row.id,
    )
      .map((item) => String(item.evaluationId))
      .sort();
    const hash = createHash('sha256')
      .update(evalIds.join(','))
      .digest('hex')
      .slice(0, 32);
    if (hash !== row.inputSetHash)
      fail(
        400,
        'ARCHIVE_DERIVED_STATE',
        'Source score input hash is inconsistent.',
      );
  }
  return {
    archive,
    ids,
    counts: archive.manifest.counts,
    warnings: [
      'The destination event will be private and unpublished.',
      'Imported webhook subscriptions will be disabled until a new secret is configured.',
      'Historical judge signatures remain source-issued and are not re-signed.',
    ],
    privacyConsequences: [
      'Source accounts become deactivated unclaimed placeholders; emails and credentials do not travel.',
      'Only aggregate vote totals travel. Individual ballots and voter identities cannot be reconstructed.',
      'Private evaluation comments are included as organizer-owned evidence.',
      'Comment authors become separate unclaimed placeholders without voting credentials.',
    ],
  };
}
