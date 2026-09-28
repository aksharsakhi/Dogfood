# Embedded gallery (T4D)

Organizers configure framing at `/events/:eventId/manage`, in **Embeddable gallery**. Add one or more exact origins and save. The read-only iframe URL is `/embed/events/:eventId`; the editor generates a copyable absolute URL and snippet for the current DogFood host:

```html
<iframe
  src="https://dogfood.example/embed/events/EVENT_UUID"
  title="Event gallery"
  loading="lazy"
  width="100%"
  height="600"
></iframe>
```

An empty allowed-origin list disables framing, including first-party framing: the response sends `Content-Security-Policy: frame-ancestors 'none'`. A configured list sends `frame-ancestors 'self' https://example.com ...`; `'self'` permits DogFood to frame its own embed, while each external origin remains exact. There are no wildcard or subdomain patterns. The normal gallery and other application routes keep their existing framing behavior; non-embed management-page clickjacking hardening is outside this T4 checkpoint.

An origin is `http://` or `https://` followed by a host and optional port, with at most a trailing `/`. The server rejects credentials, non-root paths, query strings, fragments, whitespace/control characters, CSP tokens, and wildcard hosts. URL parsing canonicalizes scheme and host case, default ports, and trailing root slashes; duplicates are removed and entries sorted. For example `HTTPS://EXAMPLE.COM:443/` becomes `https://example.com`. Origin values are validated again before construction of the CSP header. `GET /events/:eventId/embed-config` and `PATCH /events/:eventId/embed-config` require active organizer membership for that event. The update body is `{ "allowedOrigins": ["https://example.com"] }`; changes append an audit event. Public iframe reads are not audited.

The embed uses the same public gallery eligibility checks and project query as the normal gallery. Private, draft, unpublished, or gallery-hidden events return no embed data even if an origin is configured. Only active submitted public projects appear. Track filtering, text search, pagination, and links to public gallery details are available. The embed has no session or account UI and never forwards browser cookies to its server-side API requests, so a signed-in browser receives the same dataset as an anonymous browser. It offers no voting, commenting, submission, organizer, judging, webhook, archive, or other mutation controls. Existing API mutation authorization remains separate.

An origin allowlist limits **which sites can frame the page**; it does not make already-public gallery data secret, stop a permitted site from presenting misleading content around the frame, or authenticate the embedding site. CSP `frame-ancestors` is enforced by supporting browsers on the embed document response, not by JavaScript, CORS, Origin, or Referer. Use HTTPS in production for both DogFood and the host page.

The exact origin list is portable in archive schema v1 as an additive optional event field. Older valid v1 packages without it remain accepted and import as an empty list. Imported events are always draft/private/gallery-hidden; preserved origins cannot publish them. Review the list before separately publishing an imported event.
