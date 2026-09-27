import { JudgeInvitation } from '../../../components/judge-invitation';
export default async function JudgeInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JudgeInvitation token={token} />;
}
