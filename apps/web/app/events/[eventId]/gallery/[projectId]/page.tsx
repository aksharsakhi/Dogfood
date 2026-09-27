import { GalleryDetail } from '../../../../../components/gallery';
export default async function GalleryProjectPage({
  params,
}: {
  params: Promise<{ eventId: string; projectId: string }>;
}) {
  const { eventId, projectId } = await params;
  return <GalleryDetail eventId={eventId} projectId={projectId} />;
}
