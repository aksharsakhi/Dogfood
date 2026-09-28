import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

const eventId = '8727a75d-bbe8-584a-9c95-d5c1a916e38c';
const fixtureCookie = createHash('sha256')
  .update('dogfood-2026-official-fixture:acceptance-cookie:organizer')
  .digest('base64url');

async function host(embedUrl: string) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<html><body><iframe src="${embedUrl}" title="External gallery"></iframe></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Host server did not bind.');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('actual browser enforces allowed and denied framing; embed remains public and read-only', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  const base = new URL(
    test.info().project.use.baseURL ?? 'http://localhost:3000',
  );
  const embedUrl = `${base.origin}/embed/events/${eventId}`;
  const allowed = await host(embedUrl);
  const denied = await host(embedUrl);
  await context.addCookies([
    {
      name: 'dogfood_session',
      value: fixtureCookie,
      domain: base.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const configUrl = `${base.origin}/api/events/${eventId}/embed-config`;
  const original = await request.get(configUrl, {
    headers: { Cookie: `dogfood_session=${fixtureCookie}` },
  });
  expect(original.ok()).toBeTruthy();
  const originalOrigins = (
    (await original.json()) as { allowedOrigins: string[] }
  ).allowedOrigins;
  try {
    const update = await request.patch(configUrl, {
      headers: {
        Cookie: `dogfood_session=${fixtureCookie}`,
        Origin: base.origin,
      },
      data: { allowedOrigins: [allowed.origin] },
    });
    expect(update.ok()).toBeTruthy();
    const embedResponse = await request.get(embedUrl);
    expect(embedResponse.status()).toBe(200);
    expect(embedResponse.headers()['content-security-policy']).toContain(
      `frame-ancestors 'self' ${allowed.origin}`,
    );
    const anonymousHtml = await embedResponse.text();
    const authenticatedHtml = await (
      await request.get(embedUrl, {
        headers: { Cookie: `dogfood_session=${fixtureCookie}` },
      })
    ).text();
    expect(authenticatedHtml).toBe(anonymousHtml);
    expect(anonymousHtml).not.toContain('dogfood_session');
    expect(anonymousHtml).not.toMatch(
      /<form[^>]+method=["']post["']|<textarea|type=["']password["']/i,
    );
    const normal = await request.get(
      `${base.origin}/events/${eventId}/gallery`,
    );
    expect(normal.headers()['content-security-policy'] ?? '').not.toContain(
      'frame-ancestors',
    );
    const organizerPage = await request.get(
      `${base.origin}/events/${eventId}/manage`,
      { headers: { Cookie: `dogfood_session=${fixtureCookie}` } },
    );
    expect(organizerPage.ok()).toBeTruthy();
    expect(
      organizerPage.headers()['content-security-policy'] ?? '',
    ).not.toContain('frame-ancestors');
    const apiResponse = await request.get(
      `${base.origin}/api/events/${eventId}/gallery`,
    );
    expect(apiResponse.ok()).toBeTruthy();
    expect(
      apiResponse.headers()['content-security-policy'] ?? '',
    ).not.toContain('frame-ancestors');
    for (const response of [normal, organizerPage, apiResponse])
      expect(response.headers()['x-frame-options']).toBeUndefined();

    await page.goto(allowed.origin);
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: /gallery/i }),
    ).toBeVisible();
    await expect(
      page.frameLocator('iframe').getByRole('button', {
        name: /vote|comment|submit|judge|organize|archive/i,
      }),
    ).toHaveCount(0);
    await page.goto(denied.origin);
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: /gallery/i }),
    ).toHaveCount(0);

    const disable = await request.patch(configUrl, {
      headers: {
        Cookie: `dogfood_session=${fixtureCookie}`,
        Origin: base.origin,
      },
      data: { allowedOrigins: [] },
    });
    expect(disable.ok()).toBeTruthy();
    expect(
      (await request.get(embedUrl)).headers()['content-security-policy'],
    ).toContain("frame-ancestors 'none'");
  } finally {
    await request.patch(configUrl, {
      headers: {
        Cookie: `dogfood_session=${fixtureCookie}`,
        Origin: base.origin,
      },
      data: { allowedOrigins: originalOrigins },
    });
    await close(allowed.server);
    await close(denied.server);
  }
});
