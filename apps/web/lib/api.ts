import type { HealthResponse } from '@dogfood/contracts';
/** Server-side client: internal service URLs never need to reach the browser. */
export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/health`,
    { cache: 'no-store', signal: AbortSignal.timeout(2500) },
  );
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('status' in body) ||
    body.status !== 'ok' ||
    !('service' in body) ||
    body.service !== 'api'
  )
    throw new Error('Unexpected health response');
  return { status: 'ok', service: 'api' };
}
