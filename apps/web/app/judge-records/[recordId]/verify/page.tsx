import { JudgeRecordVerifier } from '../../../../components/judge-record-verifier';

export default async function JudgeRecordVerificationPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  return <JudgeRecordVerifier recordId={recordId} />;
}
