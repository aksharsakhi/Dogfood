import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
const password = 'Browser test password 123!';
async function account(page: Page, name: string, email: string) {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
}
test('organizer invites, publishes rubric and assignments, judge evaluates, organizer sees progress', async ({
  browser,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const organizer = await browser.newPage();
  const participant = await browser.newPage();
  const judge = await browser.newPage();
  participant.on('dialog', (dialog) => void dialog.accept());
  try {
    const judgeEmail = `browser-judge-${suffix}@example.test`;
    await account(
      organizer,
      'Judging Organizer',
      `browser-judging-organizer-${suffix}@example.test`,
    );
    await account(
      participant,
      'Judging Participant',
      `browser-judging-participant-${suffix}@example.test`,
    );
    await account(judge, 'Judging Judge', judgeEmail);
    await organizer.goto('/events/new');
    await organizer.getByLabel('Name').fill(`Judging Browser Event ${suffix}`);
    await organizer.getByLabel('Slug').fill(`judging-browser-${suffix}`);
    const date = (offset: number) =>
      new Date(Date.now() + offset).toISOString().slice(0, 16);
    await organizer.getByLabel('Registration opens').fill(date(-86400000));
    await organizer.getByLabel('Registration closes').fill(date(7 * 86400000));
    await organizer.getByLabel('Submission opens').fill(date(-86400000));
    await organizer.getByLabel('Submission closes').fill(date(2 * 86400000));
    await organizer.getByLabel('Judging opens').fill(date(3 * 86400000));
    await organizer.getByLabel('Judging closes').fill(date(4 * 86400000));
    await organizer.getByRole('button', { name: 'Save event' }).click();
    await expect(organizer).toHaveURL(/\/events\/[0-9a-f-]+\/manage$/);
    const eventUrl = organizer.url().replace(/\/manage$/, '');
    await organizer.getByRole('button', { name: 'Publish event' }).click();
    await expect(organizer.getByText('State: PUBLISHED')).toBeVisible();

    await participant.goto(eventUrl);
    await participant
      .getByRole('button', { name: 'Register for this event' })
      .click();
    const team = participant
      .getByRole('heading', { name: 'Create a team' })
      .locator('..');
    await team.getByLabel('Name').fill(`Judging Team ${suffix}`);
    await team.getByLabel('Slug').fill(`judging-team-${suffix}`);
    await team.getByRole('button', { name: 'Create team' }).click();
    const project = participant
      .getByRole('heading', { name: 'Create project' })
      .locator('..');
    await project.getByLabel('Name').fill(`Judging Project ${suffix}`);
    await project.getByLabel('Slug').fill(`judging-project-${suffix}`);
    await project.getByRole('button', { name: 'Create project' }).click();
    const draft = participant
      .getByRole('heading', { name: 'Create first draft' })
      .locator('..');
    await draft.getByLabel('Description').fill('A submitted judging snapshot');
    await draft.getByRole('button', { name: 'Create draft' }).click();
    await expect(
      participant.getByRole('heading', { name: 'Edit draft v1' }),
    ).toBeVisible();
    await participant.getByRole('button', { name: 'Submit v1' }).click();
    await expect(participant.getByText('Latest submitted: v1')).toBeVisible();

    await organizer.goto(`${eventUrl}/manage`);
    await expect(
      organizer
        .getByRole('group', { name: 'Basic information' })
        .getByLabel('Name'),
    ).toHaveValue(`Judging Browser Event ${suffix}`);
    await organizer.getByLabel('Submission closes').fill(date(-12 * 3600000));
    await organizer.getByLabel('Judging opens').fill(date(-11 * 3600000));
    await organizer.getByLabel('Judging closes').fill(date(86400000));
    await organizer.getByRole('button', { name: 'Save event' }).click();
    await expect(organizer.getByText('Saved.')).toBeVisible();
    await organizer
      .getByRole('link', { name: 'Judging setup and progress' })
      .click();
    await expect(
      organizer.getByRole('heading', { name: 'Judging setup and progress' }),
    ).toBeVisible();
    await organizer.getByLabel('Judge email').fill(judgeEmail);
    await organizer.getByRole('button', { name: 'Invite judge' }).click();
    const invitationLink = await organizer
      .getByRole('link', { name: /judge-invitations/ })
      .getAttribute('href');
    expect(invitationLink).toMatch(/\/judge-invitations\/[A-Za-z0-9_-]{43}$/);
    await judge.goto(invitationLink!);
    await judge
      .getByRole('button', { name: 'Accept judge invitation' })
      .click();
    await judge.getByRole('link', { name: 'Open judge workspace' }).click();
    await expect(
      judge.getByText('No published assignments yet.'),
    ).toBeVisible();

    const criterionFields = organizer.getByRole('group', { name: /Criterion/ });
    await criterionFields.nth(0).getByLabel('name').fill('Impact');
    await criterionFields.nth(0).getByLabel('weight').fill('0.4');
    await criterionFields.nth(1).getByLabel('name').fill('Execution');
    await criterionFields.nth(1).getByLabel('weight').fill('0.6');
    await organizer
      .getByRole('button', { name: 'Create draft rubric' })
      .click();
    await expect(organizer.getByText('Draft rubric created.')).toBeVisible();
    await organizer.getByRole('button', { name: 'Publish rubric' }).click();
    await expect(organizer.getByText('Rubric published.')).toBeVisible();
    await organizer.getByRole('button', { name: 'Run preflight' }).click();
    await expect(
      organizer.getByText(/Required 1 · achievable 1 · shortfall 0/),
    ).toBeVisible();
    await organizer.getByRole('button', { name: 'Generate preview' }).click();
    await expect(
      organizer.getByText(/1 proposed pairs · shortfall 0/),
    ).toBeVisible();
    const ack = organizer.getByLabel(
      'Acknowledge publishing while submissions are open',
    );
    if (await ack.isVisible()) {
      await ack.check();
    }
    await organizer
      .getByRole('button', { name: 'Publish assignments' })
      .click();
    await expect(organizer.getByText('Assignments published.')).toBeVisible();

    await judge.reload();
    await expect(judge.getByText('1 assigned · 0 completed')).toBeVisible();
    await judge
      .getByRole('link', { name: `Judging Project ${suffix}` })
      .click();
    const scores = judge.getByRole('spinbutton');
    await scores.nth(0).fill('8');
    await scores.nth(1).fill('7');
    await judge.getByRole('button', { name: 'Save draft' }).click();
    await expect(judge.getByText('Draft saved.')).toBeVisible();
    await judge.getByRole('button', { name: 'Submit evaluation' }).click();
    await expect(judge.getByText('Evaluation submitted.')).toBeVisible();

    await organizer.getByRole('button', { name: 'Refresh progress' }).click();
    await expect(
      organizer.getByRole('listitem').filter({ hasText: 'Judging Judge:' }),
    ).toHaveText('Judging Judge: 1 assigned, 1 completed, 0 remaining');

    // Phase 4B flow:
    // 1. Organizer creates ScoreRun
    await organizer
      .getByRole('button', { name: 'Run scoring (Z_SCORE_V1)' })
      .click();
    await expect(organizer.getByText(/ScoreRun .* created/)).toBeVisible();
    await expect(
      organizer.getByRole('table').filter({ hasText: 'Z_SCORE V1' }),
    ).toBeVisible();

    // 2. Organizer views details: sees raw average vs normalized score
    await organizer
      .getByRole('button', { name: 'View details' })
      .first()
      .click();
    await expect(
      organizer.getByRole('heading', { name: /Score run details/ }),
    ).toBeVisible();
    await expect(
      organizer.getByRole('columnheader', { name: 'Raw average' }),
    ).toBeVisible();
    await expect(
      organizer.getByRole('columnheader', { name: 'Normalized score' }),
    ).toBeVisible();

    // 3. Organizer explicitly picks ScoreRun and creates ResultRun
    await organizer
      .getByLabel('Select completed ScoreRun:')
      .selectOption({ index: 1 });
    await organizer.getByRole('button', { name: 'Create ResultRun' }).click();
    await expect(organizer.getByText(/ResultRun .* created/)).toBeVisible();

    // 4. Organizer views rankings
    await organizer
      .getByRole('button', { name: 'View rankings' })
      .first()
      .click();
    await expect(
      organizer.getByRole('heading', { name: /Result rankings/ }),
    ).toBeVisible();

    // 5. Organizer downloads derived CSV
    const downloadPromise = organizer.waitForEvent('download');
    await organizer.getByRole('button', { name: 'Export Results CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('results');
  } finally {
    await organizer.close();
    await participant.close();
    await judge.close();
  }
});
