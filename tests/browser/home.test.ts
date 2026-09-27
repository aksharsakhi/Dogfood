import { expect, test } from '@playwright/test';
test('landing page exposes the application shell and service status', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'fair starting line',
  );
  await expect(page.getByRole('status')).toContainText('API');
});
