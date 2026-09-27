import { VotingResults } from '../../../../../components/voting-results';

export default async function VotingResultsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <VotingResults eventId={eventId} />;
}
