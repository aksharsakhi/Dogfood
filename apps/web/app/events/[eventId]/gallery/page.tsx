import { Gallery } from '../../../../components/gallery';
export default async function GalleryPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <Gallery eventId={eventId} />;
}
