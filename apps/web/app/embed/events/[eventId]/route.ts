import { NextRequest } from 'next/server';

interface EmbedMeta {
  name: string;
  allowedOrigins: string[];
}
interface GalleryItem {
  id: string;
  projectName: string;
  tagline: string | null;
  teamName: string;
  trackName: string | null;
}
interface GalleryList {
  items: GalleryItem[];
  total: number;
  page: number;
  pageSize: number;
}
interface Track {
  id: string;
  name: string;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );

function response(html: string, status: number, origins: string[] = []) {
  const ancestors = origins.length
    ? `frame-ancestors 'self' ${origins.join(' ')}`
    : "frame-ancestors 'none'";
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; ${ancestors}`,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function getPublic<T>(path: string): Promise<T | null> {
  const upstream = await fetch(
    `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}${path}`,
    {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    },
  );
  return upstream.ok ? ((await upstream.json()) as T) : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(eventId))
    return response('Not found', 404);
  try {
    const base = `/events/${eventId}`;
    const meta = await getPublic<EmbedMeta>(`${base}/gallery/embed-meta`);
    if (!meta) return response('Not found', 404);
    // Re-parse API values before constructing a browser security header.
    const origins = meta.allowedOrigins.map((origin) => {
      const parsed = new URL(origin);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin !== origin ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('Invalid stored embed origin');
      return origin;
    });
    const search =
      request.nextUrl.searchParams.get('search')?.slice(0, 100) ?? '';
    const trackId = request.nextUrl.searchParams.get('trackId') ?? '';
    const page = Math.min(
      1000000,
      Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1),
    );
    const query = new URLSearchParams({
      page: String(Math.floor(page)),
      pageSize: '12',
    });
    if (search) query.set('search', search);
    if (/^[a-f0-9-]{36}$/i.test(trackId)) query.set('trackId', trackId);
    const [gallery, tracks] = await Promise.all([
      getPublic<GalleryList>(`${base}/gallery?${query}`),
      getPublic<Track[]>(`${base}/tracks`),
    ]);
    if (!gallery || !tracks) return response('Not found', 404);
    const action = `/embed/events/${eventId}`;
    const pages = (target: number) => {
      const p = new URLSearchParams(query);
      p.set('page', String(target));
      return `${action}?${p}`;
    };
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(meta.name)} gallery</title><style>body{font:16px system-ui,sans-serif;max-width:760px;margin:auto;padding:1rem;color:#17212b}li{padding:.8rem;border-bottom:1px solid #ddd}a{color:#12577a}label{margin-right:1rem}</style></head><body><main><h1>${escapeHtml(meta.name)} gallery</h1><form method="get" action="${action}"><label>Search <input name="search" value="${escapeHtml(search)}"></label><label>Track <select name="trackId"><option value="">All tracks</option>${tracks.map((track) => `<option value="${escapeHtml(track.id)}"${track.id === trackId ? ' selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select></label><button>Search gallery</button></form><p>${gallery.total} submitted projects</p><ul>${gallery.items.map((project) => `<li><a href="/events/${eventId}/gallery/${encodeURIComponent(project.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.projectName)}</a> · ${escapeHtml(project.teamName)}${project.trackName ? ` · ${escapeHtml(project.trackName)}` : ''}${project.tagline ? `<p>${escapeHtml(project.tagline)}</p>` : ''}</li>`).join('')}</ul>${page > 1 ? `<a href="${escapeHtml(pages(page - 1))}">Previous</a>` : ''} ${page * gallery.pageSize < gallery.total ? `<a href="${escapeHtml(pages(page + 1))}">Next</a>` : ''}</main></body></html>`;
    return response(html, 200, origins);
  } catch {
    return response('Unavailable', 503);
  }
}
