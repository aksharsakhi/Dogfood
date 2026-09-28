import { createHash } from 'node:crypto';
import { fail } from '../../common/errors/domain-error';

export const ARCHIVE_FORMAT = 'dogfood-event-archive' as const;
export const ARCHIVE_VERSION = 1 as const;
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ROWS = 50_000;
export const MAX_COLLECTION_ROWS = 10_000;

// An explicit allowlist prevents future schema fields from leaking into archives.
export const EVENT_FIELDS = [
  'id',
  'slug',
  'name',
  'shortDescription',
  'description',
  'rules',
  'eligibility',
  'timezone',
  'registrationOpensAt',
  'registrationClosesAt',
  'submissionOpensAt',
  'submissionClosesAt',
  'judgingOpensAt',
  'judgingClosesAt',
  'votingOpensAt',
  'votingClosesAt',
  'votingAccessMode',
  'resultsPublishAt',
  'minTeamSize',
  'maxTeamSize',
  'visibility',
  'galleryVisibility',
  'status',
  'createdById',
  'createdAt',
] as const;

export const MODEL_FIELDS = {
  EventMembership: ['id', 'eventId', 'userId', 'role', 'status', 'createdAt'],
  Track: [
    'id',
    'eventId',
    'name',
    'slug',
    'description',
    'maxSubmissions',
    'createdAt',
  ],
  Prize: [
    'id',
    'eventId',
    'trackId',
    'name',
    'description',
    'position',
    'amount',
    'currency',
    'createdAt',
  ],
  Registration: [
    'id',
    'eventId',
    'userId',
    'status',
    'metadata',
    'registeredAt',
    'withdrawnAt',
  ],
  Team: ['id', 'eventId', 'name', 'slug', 'createdById', 'status', 'createdAt'],
  TeamMember: [
    'id',
    'eventId',
    'teamId',
    'userId',
    'role',
    'joinedAt',
    'leftAt',
  ],
  Project: [
    'id',
    'eventId',
    'teamId',
    'trackId',
    'name',
    'slug',
    'tagline',
    'description',
    'repositoryUrl',
    'demoUrl',
    'status',
    'createdAt',
  ],
  Submission: [
    'id',
    'projectId',
    'version',
    'title',
    'description',
    'repositoryUrl',
    'demoUrl',
    'projectName',
    'projectTagline',
    'trackId',
    'trackName',
    'status',
    'createdById',
    'submittedAt',
    'lockedAt',
    'createdAt',
  ],
  JudgeProfile: [
    'id',
    'eventMembershipId',
    'bio',
    'organization',
    'maxAssignments',
    'available',
    'createdAt',
  ],
  JudgeExpertise: ['judgeProfileId', 'trackId', 'expertiseLevel'],
  JudgeConflict: [
    'id',
    'judgeProfileId',
    'teamId',
    'projectId',
    'organization',
    'type',
    'reason',
    'createdAt',
  ],
  Rubric: [
    'id',
    'eventId',
    'name',
    'version',
    'status',
    'publishedAt',
    'createdAt',
  ],
  RubricCriterion: [
    'id',
    'rubricId',
    'name',
    'description',
    'weight',
    'minScore',
    'maxScore',
    'displayOrder',
    'createdAt',
  ],
  AssignmentRun: [
    'id',
    'eventId',
    'rubricVersionId',
    'type',
    'status',
    'reviewsPerSubmission',
    'algorithm',
    'algorithmVersion',
    'allocationSource',
    'previewStats',
    'createdById',
    'createdAt',
    'publishedAt',
  ],
  AssignmentRunProposal: ['id', 'runId', 'judgeProfileId', 'submissionId'],
  JudgeAssignment: [
    'id',
    'eventId',
    'runId',
    'rubricId',
    'judgeProfileId',
    'submissionId',
    'assignmentMethod',
    'assignedById',
    'assignedAt',
    'status',
  ],
  Evaluation: [
    'id',
    'assignmentId',
    'rubricId',
    'status',
    'comments',
    'startedAt',
    'submittedAt',
    'lockedAt',
    'createdAt',
  ],
  EvaluationScore: [
    'id',
    'evaluationId',
    'criterionId',
    'score',
    'comment',
    'createdAt',
  ],
  ScoreRun: [
    'id',
    'eventId',
    'status',
    'algorithm',
    'algorithmVersion',
    'method',
    'methodVersion',
    'parameters',
    'rubricVersionId',
    'inputSetHash',
    'coverageDiagnostics',
    'normalizationDiagnostics',
    'completedAt',
    'failedAt',
    'failureReason',
    'createdById',
    'createdAt',
  ],
  NormalizedScore: [
    'id',
    'scoreRunId',
    'evaluationId',
    'judgeProfileId',
    'submissionId',
    'projectId',
    'rawScore',
    'normalizedScore',
    'diagnostic',
    'createdAt',
  ],
  ProjectScore: [
    'id',
    'scoreRunId',
    'projectId',
    'aggregatedScore',
    'rawAverage',
    'evaluationCount',
    'requiredCount',
    'coverageComplete',
    'createdAt',
  ],
  ResultRun: [
    'id',
    'eventId',
    'scoreRunId',
    'status',
    'coverageIncomplete',
    'overrideReason',
    'overrideActorId',
    'rankingPolicy',
    'rankingVersion',
    'coverageSnapshot',
    'generatedAt',
    'publishedAt',
    'createdById',
  ],
  ProjectResult: [
    'id',
    'resultRunId',
    'projectId',
    'score',
    'rank',
    'tieGroup',
    'createdAt',
  ],
  JudgeScoreStats: [
    'id',
    'scoreRunId',
    'judgeProfileId',
    'evaluationCount',
    'mean',
    'populationStdDev',
    'diagnostic',
    'createdAt',
  ],
  JudgeRecordSigningKey: [
    'id',
    'publicKeyPem',
    'fingerprint',
    'createdAt',
    'retiredAt',
  ],
  JudgeRecordKeyRotation: [
    'id',
    'previousKeyId',
    'activeKeyId',
    'previousFingerprint',
    'activeFingerprint',
    'rotatedAt',
  ],
  JudgeRecordSubject: ['id', 'eventId', 'judgeProfileId', 'createdAt'],
  JudgeParticipationRecord: [
    'id',
    'eventId',
    'judgeProfileId',
    'subjectId',
    'assignmentCount',
    'evaluationCount',
    'schemaVersion',
    'issuedAt',
    'issuerKeyId',
    'canonicalPayload',
    'signature',
    'supersedesRecordId',
    'sourceInstanceId',
    'sourceEventId',
    'sourceRecordId',
  ],
  JudgeRecordRevocation: [
    'id',
    'recordId',
    'issuerKeyId',
    'schemaVersion',
    'revokedAt',
    'canonicalPayload',
    'signature',
  ],
  WebhookSubscription: [
    'id',
    'eventId',
    'createdById',
    'url',
    'eventTypes',
    'active',
    'createdAt',
  ],
} as const;

export type ArchiveModel = keyof typeof MODEL_FIELDS;
export type ArchiveRow = Record<string, unknown>;
export type ArchiveEntities = Record<ArchiveModel, ArchiveRow[]>;
export interface EventArchive {
  format: typeof ARCHIVE_FORMAT;
  schemaVersion: typeof ARCHIVE_VERSION;
  source: { instanceId: string; eventId: string };
  exportedAt: string;
  manifest: { counts: Record<string, number>; totalRows: number };
  payload: {
    event: ArchiveRow;
    users: Array<{ id: string; displayName: string }>;
    entities: ArchiveEntities;
    voteAggregates: Array<{ projectId: string; count: number }>;
    comments: Array<{
      id: string;
      projectId: string;
      body: string;
      status: string;
      createdAt: string;
      hiddenAt: string | null;
    }>;
  };
  packageHash: string;
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function guardStructure(value: unknown, depth = 0): void {
  if (depth > 40) fail(400, 'ARCHIVE_INVALID', 'Archive nesting is too deep.');
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ROWS)
      fail(400, 'ARCHIVE_LIMIT', 'Archive collection limit exceeded.');
    for (const item of value) guardStructure(item, depth + 1);
  } else if (object(value)) {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail(400, 'ARCHIVE_INVALID', 'Archive contains an unsafe object.');
    const keys = Object.keys(value);
    if (keys.length > 250)
      fail(400, 'ARCHIVE_LIMIT', 'Archive object has too many fields.');
    for (const key of keys) {
      if (forbiddenKeys.has(key))
        fail(400, 'ARCHIVE_INVALID', 'Archive contains a prohibited key.');
      guardStructure(value[key], depth + 1);
    }
  } else if (typeof value === 'string' && value.length > 1_000_000) {
    fail(400, 'ARCHIVE_LIMIT', 'Archive string is too long.');
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    fail(400, 'ARCHIVE_INVALID', 'Archive has a non-finite number.');
  }
}

export function canonicalSerialize(value: unknown): string {
  guardStructure(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSerialize).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function packageHash(
  unsigned: Omit<EventArchive, 'packageHash'>,
): string {
  return createHash('sha256')
    .update(canonicalSerialize(unsigned))
    .digest('hex');
}

export function manifestFor(payload: EventArchive['payload']) {
  const counts: Record<string, number> = {
    users: payload.users.length,
    voteAggregates: payload.voteAggregates.length,
    comments: payload.comments.length,
  };
  for (const model of Object.keys(MODEL_FIELDS) as ArchiveModel[])
    counts[model] = payload.entities[model].length;
  return {
    counts,
    totalRows: Object.values(counts).reduce((sum, count) => sum + count, 1),
  };
}

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!object(value))
    fail(400, 'ARCHIVE_INVALID', `${label} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      fail(400, 'ARCHIVE_UNKNOWN_FIELD', `Unsupported ${label} field: ${key}.`);
  for (const key of allowed)
    if (!(key in value))
      fail(400, 'ARCHIVE_INVALID', `Missing ${label} field: ${key}.`);
}

export function parseArchive(input: unknown): EventArchive {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  if (Buffer.byteLength(raw, 'utf8') > MAX_ARCHIVE_BYTES)
    fail(413, 'ARCHIVE_LIMIT', 'Archive exceeds the upload limit.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(400, 'ARCHIVE_INVALID', 'Archive is not valid JSON.');
  }
  guardStructure(value);
  exactKeys(
    value,
    [
      'format',
      'schemaVersion',
      'source',
      'exportedAt',
      'manifest',
      'payload',
      'packageHash',
    ],
    'package',
  );
  if (
    value.format !== ARCHIVE_FORMAT ||
    value.schemaVersion !== ARCHIVE_VERSION
  )
    fail(
      400,
      'ARCHIVE_VERSION',
      'Unsupported archive format or schema version.',
    );
  exactKeys(value.source, ['instanceId', 'eventId'], 'source');
  if (!uuid(value.source.instanceId) || !uuid(value.source.eventId))
    fail(400, 'ARCHIVE_INVALID', 'Source identifiers must be UUIDs.');
  if (
    typeof value.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.exportedAt))
  )
    fail(400, 'ARCHIVE_INVALID', 'Invalid export timestamp.');
  exactKeys(value.manifest, ['counts', 'totalRows'], 'manifest');
  exactKeys(
    value.payload,
    ['event', 'users', 'entities', 'voteAggregates', 'comments'],
    'payload',
  );
  exactKeys(value.payload.event, EVENT_FIELDS, 'event');
  if (value.payload.event.id !== value.source.eventId)
    fail(400, 'ARCHIVE_INVALID', 'Source event identifier mismatch.');
  if (
    !Array.isArray(value.payload.users) ||
    !Array.isArray(value.payload.voteAggregates) ||
    !Array.isArray(value.payload.comments)
  )
    fail(400, 'ARCHIVE_INVALID', 'Archive collections must be arrays.');
  for (const row of value.payload.users)
    exactKeys(row, ['id', 'displayName'], 'user');
  for (const row of value.payload.voteAggregates)
    exactKeys(row, ['projectId', 'count'], 'vote aggregate');
  for (const row of value.payload.comments)
    exactKeys(
      row,
      ['id', 'projectId', 'body', 'status', 'createdAt', 'hiddenAt'],
      'comment',
    );
  exactKeys(value.payload.entities, Object.keys(MODEL_FIELDS), 'entities');
  for (const model of Object.keys(MODEL_FIELDS) as ArchiveModel[]) {
    const rows = value.payload.entities[model];
    if (!Array.isArray(rows))
      fail(400, 'ARCHIVE_INVALID', `${model} must be an array.`);
    for (const row of rows) exactKeys(row, MODEL_FIELDS[model], model);
  }
  const archive = value as unknown as EventArchive;
  const expected = manifestFor(archive.payload);
  if (expected.totalRows > MAX_TOTAL_ROWS)
    fail(413, 'ARCHIVE_LIMIT', 'Archive entity limit exceeded.');
  if (canonicalSerialize(expected) !== canonicalSerialize(archive.manifest))
    fail(
      400,
      'ARCHIVE_MANIFEST',
      'Archive manifest counts do not match payload.',
    );
  const { packageHash: declared, ...unsigned } = archive;
  if (
    typeof declared !== 'string' ||
    !/^[a-f0-9]{64}$/.test(declared) ||
    packageHash(unsigned) !== declared
  )
    fail(400, 'ARCHIVE_CHECKSUM', 'Archive package checksum does not match.');
  return archive;
}

export const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
