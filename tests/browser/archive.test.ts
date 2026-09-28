import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const eventId = '8727a75d-bbe8-584a-9c95-d5c1a916e38c';
const fixtureCookie = createHash('sha256')
  .update('dogfood-2026-official-fixture:acceptance-cookie:organizer')
  .digest('base64url');

test('organizer downloads, previews, confirms and rechecks an event archive', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const url = new URL(
    test.info().project.use.baseURL ?? 'http://localhost:3000',
  );
  await context.addCookies([
    {
      name: 'dogfood_session',
      value: fixtureCookie,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`/events/${eventId}/manage`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download event archive' }).click();
  expect((await download).suggestedFilename()).toContain(eventId);
  const response = await context.request.get(`/api/events/${eventId}/archive`);
  expect(response.ok()).toBeTruthy();
  const archive = await response.json();

  await page.goto('/events/archive');
  await page.getByLabel('Select archive JSON').setInputFiles({
    name: 'event-archive.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import preview' }),
  ).toBeVisible();
  await expect(
    page.getByText(`Package hash: ${archive.packageHash}`),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm import' }),
  ).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByRole('status')).toContainText('Event imported.');
  await expect(
    page.getByRole('link', { name: 'Open destination event' }),
  ).toHaveAttribute('href', /\/events\/[a-f0-9-]+\/manage/);
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByRole('status')).toContainText('already imported');
});
