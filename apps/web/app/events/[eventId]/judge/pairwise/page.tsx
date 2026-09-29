import { PairwiseJudge } from '../../../../../components/pairwise-judge';
export default async function PairwisePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <PairwiseJudge eventId={eventId} />;
}
