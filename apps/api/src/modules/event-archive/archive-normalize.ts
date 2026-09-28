import { createHash } from 'node:crypto';
import { canonicalSerialize, type EventArchive } from './archive-format';
import type { IdPlan } from './archive-plan';

// This comparator removes only documented destination effects. All other
// domain fields, dates, comments, scores, and signatures remain comparable.
export function semanticNormalize(
  archive: EventArchive,
  remapping?: IdPlan,
): string {
  const inverse: Record<string, string> = {};
  if (remapping)
    for (const map of Object.values(remapping))
      for (const [source, destination] of Object.entries(map))
        if (!source.includes(':')) inverse[destination] = source;
  const reverse = (value: unknown): unknown => {
    if (typeof value === 'string') return inverse[value] ?? value;
    if (Array.isArray(value)) return value.map(reverse);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, reverse(item)]),
      );
    return value;
  };
  const event = reverse(archive.payload.event) as Record<string, unknown>;
  event.slug = '<destination-slug>';
  event.createdById = '<importing-organizer>';
  event.status = '<destination-publication>';
  event.visibility = '<destination-publication>';
  event.galleryVisibility = '<destination-publication>';

  const sourceUserIds = remapping
    ? new Set(Object.values(remapping.User ?? {}))
    : null;
  const users = archive.payload.users
    .filter((row) => !sourceUserIds || sourceUserIds.has(row.id))
    .map((row) => reverse(row))
    .sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const entities = Object.fromEntries(
    Object.entries(archive.payload.entities).map(([model, rows]) => {
      const filtered =
        model === 'EventMembership' && sourceUserIds
          ? rows.filter((row) => sourceUserIds.has(String(row.userId)))
          : rows;
      const normalized = filtered.map((row) => {
        const value = reverse(row) as Record<string, unknown>;
        if (model === 'WebhookSubscription') value.active = false;
        if (model === 'JudgeRecordSigningKey')
          value.retiredAt = '<destination-key-lifecycle>';
        if (model === 'JudgeParticipationRecord') {
          value.sourceInstanceId = null;
          value.sourceEventId = null;
          value.sourceRecordId = null;
        }
        if (model === 'ScoreRun' && value.status === 'COMPLETED') {
          const inputIds = archive.payload.entities.NormalizedScore.filter(
            (item) => item.scoreRunId === row.id,
          )
            .map((item) => String(reverse(item.evaluationId)))
            .sort();
          value.inputSetHash = createHash('sha256')
            .update(inputIds.join(','))
            .digest('hex')
            .slice(0, 32);
        }
        return value;
      });
      normalized.sort((a, b) =>
        canonicalSerialize(a).localeCompare(canonicalSerialize(b)),
      );
      return [model, normalized];
    }),
  );
  const voteAggregates = archive.payload.voteAggregates
    .map((row) => reverse(row))
    .sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  const comments = archive.payload.comments
    .map((row) => reverse(row))
    .sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  return canonicalSerialize({
    event,
    users,
    entities,
    voteAggregates,
    comments,
  });
}
