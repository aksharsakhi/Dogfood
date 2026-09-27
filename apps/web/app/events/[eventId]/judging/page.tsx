import { JudgingOrganizer } from '../../../../components/judging-organizer';
export default async function JudgingPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <JudgingOrganizer eventId={eventId} />;
}
