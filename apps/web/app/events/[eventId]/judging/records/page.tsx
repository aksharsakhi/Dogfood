import { JudgeRecordManager } from '../../../../../components/judge-record-manager';

export default async function JudgeRecordsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <JudgeRecordManager eventId={eventId} />;
}
