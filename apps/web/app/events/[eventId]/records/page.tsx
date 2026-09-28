import { ParticipationRecords } from '../../../../components/participation-records';

export default async function ParticipationRecordsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <ParticipationRecords eventId={eventId} />;
}
