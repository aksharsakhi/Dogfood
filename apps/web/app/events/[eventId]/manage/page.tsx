import { EventEditor } from '../../../../components/event-editor';
export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <EventEditor eventId={eventId} />;
}
