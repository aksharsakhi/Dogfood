import { JudgeWorkspace } from '../../../../components/judge-workspace';
export default async function JudgePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <JudgeWorkspace eventId={eventId} />;
}
