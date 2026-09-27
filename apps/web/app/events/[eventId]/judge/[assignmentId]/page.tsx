import { JudgeEvaluation } from '../../../../../components/judge-workspace';
export default async function EvaluationPage({
  params,
}: {
  params: Promise<{ eventId: string; assignmentId: string }>;
}) {
  const { eventId, assignmentId } = await params;
  return <JudgeEvaluation eventId={eventId} assignmentId={assignmentId} />;
}
