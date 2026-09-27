import { VotingOrganizer } from '../../../../../components/voting-organizer';

export default async function VotingManagePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <VotingOrganizer eventId={eventId} />;
}
