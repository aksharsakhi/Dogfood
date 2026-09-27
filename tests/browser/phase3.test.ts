import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('participant submits versions and public gallery shows the latest snapshot', async ({
  page,
  browser,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `browser-phase3-${suffix}@example.test`;
  const password = 'Browser test password 123!';
  const organizer = await browser.newPage();
  await organizer.goto('/register');
  await organizer.getByLabel('Display name').fill('Phase 3 Organizer');
  await organizer
    .getByLabel('Email')
    .fill(`browser-organizer-${suffix}@example.test`);
  await organizer.getByLabel('Password').fill(password);
  await organizer
    .getByRole('button', { name: 'Register', exact: true })
    .click();
  await expect(organizer).toHaveURL(/\/login$/);
  await organizer
    .getByLabel('Email')
    .fill(`browser-organizer-${suffix}@example.test`);
  await organizer.getByLabel('Password').fill(password);
  await organizer.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(organizer).toHaveURL(/\/events$/);
  await organizer.goto('/events/new');
  await organizer.getByLabel('Name').fill(`Phase 3 Browser Event ${suffix}`);
  await organizer.getByLabel('Slug').fill(`phase3-browser-${suffix}`);
  const past = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  const future = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 16);
  await organizer.getByLabel('Registration opens').fill(past);
  await organizer.getByLabel('Registration closes').fill(future);
  await organizer.getByLabel('Submission opens').fill(past);
  await organizer.getByLabel('Submission closes').fill(future);
  await organizer.getByLabel('Gallery visibility').selectOption('PUBLIC');
  await organizer.getByRole('button', { name: 'Save event' }).click();
  await expect(organizer).toHaveURL(/\/events\/[0-9a-f-]+\/manage$/);
  const eventUrl = organizer.url().replace(/\/manage$/, '');
  await organizer.getByRole('button', { name: 'Publish event' }).click();
  await expect(organizer.getByText('State: PUBLISHED')).toBeVisible();

  await page.goto('/register');
  await page.getByLabel('Display name').fill('Phase 3 Participant');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto(eventUrl);
  await page.getByRole('button', { name: 'Register for this event' }).click();
  await expect(page.getByText('Registered as a participant.')).toBeVisible();

  const teamForm = page
    .getByRole('heading', { name: 'Create a team' })
    .locator('..');
  await teamForm.getByLabel('Name').fill(`Phase 3 Team ${suffix}`);
  await teamForm.getByLabel('Slug').fill(`phase3-team-${suffix}`);
  await teamForm.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByText(`Phase 3 Team ${suffix}`)).toBeVisible();

  const projectForm = page
    .getByRole('heading', { name: 'Create project' })
    .locator('..');
  await projectForm.getByLabel('Name').fill(`Phase 3 Project ${suffix}`);
  await projectForm.getByLabel('Slug').fill(`phase3-project-${suffix}`);
  await projectForm.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Project created.')).toBeVisible();

  const firstDraft = page
    .getByRole('heading', { name: 'Create first draft' })
    .locator('..');
  await firstDraft.getByLabel('Description').fill('First public snapshot');
  await firstDraft.getByRole('button', { name: 'Create draft' }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit draft v1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit v1' }).click();
  await expect(page.getByText('Latest submitted: v1')).toBeVisible();

  const nextDraft = page
    .getByRole('heading', { name: 'Create next version' })
    .locator('..');
  await nextDraft.getByLabel('Title').fill(`Updated Snapshot ${suffix}`);
  await nextDraft.getByLabel('Description').fill('Second public snapshot');
  await nextDraft.getByRole('button', { name: 'Create draft' }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit draft v2' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit v2' }).click();
  await expect(
    page.getByText(`Latest submitted: v2 — Updated Snapshot ${suffix}`),
  ).toBeVisible();

  await page.getByRole('link', { name: 'View public gallery' }).click();
  await expect(
    page.getByRole('heading', { name: 'Project gallery' }),
  ).toBeVisible();
  await page.getByLabel('Search').fill(`Updated Snapshot ${suffix}`);
  await page.getByRole('button', { name: 'Search gallery' }).click();
  await page.getByRole('link', { name: `Phase 3 Project ${suffix}` }).click();
  await expect(
    page.getByRole('heading', { name: `Phase 3 Project ${suffix}` }),
  ).toBeVisible();
  await expect(
    page.getByText(`Submitted as: Updated Snapshot ${suffix}`),
  ).toBeVisible();
  await expect(page.getByText('Submitted version 2')).toBeVisible();
  await expect(page.getByText('Second public snapshot')).toBeVisible();
});
