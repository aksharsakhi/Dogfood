import { NextRequest } from 'next/server';
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const target = `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const headers = new Headers();
  for (const key of ['cookie', 'content-type', 'origin', 'user-agent']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    });
    const responseHeaders = new Headers();
    for (const key of [
      'content-type',
      'set-cookie',
      'retry-after',
      'x-request-id',
      'cache-control',
    ]) {
      const value = upstream.headers.get(key);
      if (value)
        responseHeaders.set(
          key,
          key === 'set-cookie' && value.startsWith('dogfood_voter_')
            ? value.replace(/;\s*Path=\/events\//i, '; Path=/api/events/')
            : value,
        );
    }
    return new Response(
      upstream.status === 204 ? null : await upstream.arrayBuffer(),
      { status: upstream.status, headers: responseHeaders },
    );
  } catch {
    return Response.json(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The API is unavailable.',
        details: null,
        requestId: 'web-proxy',
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
