import { EventEditor } from '../../../components/event-editor';
export default function NewEventPage() {
  return (
    <>
      <p>
        <a href="/events/archive">Import an event archive</a>
      </p>
      <EventEditor />
    </>
  );
}
