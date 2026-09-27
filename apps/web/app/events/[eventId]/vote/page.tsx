import { VotingBallot } from '../../../../components/voting-ballot';

export default async function VotePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <VotingBallot eventId={eventId} />;
}
