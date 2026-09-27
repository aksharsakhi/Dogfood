import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const password = 'Browser test password 123!';
async function createAccount(
  page: import('@playwright/test').Page,
  displayName: string,
  email: string,
) {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
}

test('users join a team and an organizer configures and publishes an event', async ({
  browser,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `browser-owner-${suffix}@example.test`;
  const memberEmail = `browser-member-${suffix}@example.test`;
  const ownerContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const memberContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  try {
    await createAccount(owner, 'Browser Owner', ownerEmail);
    await owner.getByRole('link', { name: 'Dogfood Demo Hackathon' }).click();
    await owner
      .getByRole('button', { name: 'Register for this event' })
      .click();
    await expect(owner.getByText('Registered as a participant.')).toBeVisible();
    const createTeam = owner
      .getByRole('heading', { name: 'Create a team' })
      .locator('..');
    await createTeam.getByLabel('Name').fill(`Browser Team ${suffix}`);
    await createTeam.getByLabel('Slug').fill(`browser-team-${suffix}`);
    await createTeam.getByRole('button', { name: 'Create team' }).click();
    await expect(owner.getByText(`Browser Team ${suffix}`)).toBeVisible();

    await createAccount(member, 'Browser Member', memberEmail);
    await member.getByRole('link', { name: 'Dogfood Demo Hackathon' }).click();
    await member
      .getByRole('button', { name: 'Register for this event' })
      .click();
    await expect(
      member.getByText('Registered as a participant.'),
    ).toBeVisible();
    const invite = owner
      .getByRole('heading', { name: 'Invite a member' })
      .locator('..');
    await invite.getByLabel('Email').fill(memberEmail);
    await invite.getByRole('button', { name: 'Generate invitation' }).click();
    const invitationLink = await owner
      .getByLabel('Invitation link')
      .inputValue();
    expect(invitationLink).toMatch(/\/invitations\/[A-Za-z0-9_-]{43}$/);
    await owner.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(owner.getByRole('button', { name: 'Copied' })).toBeVisible();
    await member.goto(invitationLink);
    await expect(member.getByText(/invited to join/)).toBeVisible();
    await member.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(member.getByText(`Browser Team ${suffix}`)).toBeVisible();

    await owner.goto('/events/new');
    await owner.getByLabel('Name').fill(`Browser Event ${suffix}`);
    await owner.getByLabel('Slug').fill(`browser-event-${suffix}`);
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
    const future = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 16);
    await owner.getByLabel('Registration opens').fill(past);
    await owner.getByLabel('Registration closes').fill(future);
    await owner.getByRole('button', { name: 'Save event' }).click();
    await expect(owner).toHaveURL(/\/events\/[0-9a-f-]+\/manage$/);
    const eventUrl = owner.url().replace(/\/manage$/, '');
    const tracks = owner.getByRole('heading', { name: 'Tracks' }).locator('..');
    const addTrack = tracks.locator('form').last();
    await addTrack.getByLabel('Name').fill('Browser Track');
    await addTrack.getByLabel('Slug').fill(`browser-track-${suffix}`);
    await addTrack.getByRole('button', { name: 'Add track' }).click();
    await expect(tracks.locator('input[name="name"]').first()).toHaveValue(
      'Browser Track',
    );
    const prizes = owner.getByRole('heading', { name: 'Prizes' }).locator('..');
    const addPrize = prizes.locator('form').last();
    await addPrize.getByLabel('Name').fill('Browser Prize');
    await addPrize.getByRole('button', { name: 'Add prize' }).click();
    await expect(prizes.locator('input[name="name"]').first()).toHaveValue(
      'Browser Prize',
    );
    await owner.getByRole('button', { name: 'Publish event' }).click();
    await expect(owner.getByText('State: PUBLISHED')).toBeVisible();
    await member.goto(eventUrl);
    await member
      .getByRole('button', { name: 'Register for this event' })
      .click();
    await expect(
      member.getByText('Registered as a participant.'),
    ).toBeVisible();
    await owner.reload();
    await expect(owner.getByText('Browser Member · APPROVED')).toBeVisible();
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
