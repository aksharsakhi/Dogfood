import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../../apps/api/src/modules/identity/password';
import type { PairwiseWorkspace } from '../../apps/web/lib/pairwise';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Pairwise browser proof requires an isolated test database.');
test.use({ actionTimeout: 10000 });
const db = new PrismaClient();
const password = 'Pairwise-browser-proof-2026!';
const webUrl = process.env.WEB_URL ?? 'http://localhost:3103';
test.afterAll(async () => db.$disconnect());

async function fixture() {
  const suffix = randomUUID();
  const passwordHash = await hashPassword(password);
  const organizer = await db.user.create({
    data: {
      email: `b43-org-${suffix}@example.test`,
      displayName: 'Pairwise organizer',
      passwordHash,
    },
  });
  const judge = await db.user.create({
    data: {
      email: `b43-judge-${suffix}@example.test`,
      displayName: 'Pairwise judge',
      passwordHash,
    },
  });
  const participant = await db.user.create({
    data: {
      email: `b43-participant-${suffix}@example.test`,
      displayName: 'Participant',
      passwordHash,
    },
  });
  const event = await db.event.create({
    data: {
      name: 'Pairwise browser proof',
      slug: `b43-${suffix}`,
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    },
  });
  await db.eventMembership.createMany({
    data: [
      { eventId: event.id, userId: organizer.id, role: 'ORGANIZER' },
      { eventId: event.id, userId: participant.id, role: 'PARTICIPANT' },
    ],
  });
  const membership = await db.eventMembership.create({
    data: { eventId: event.id, userId: judge.id, role: 'JUDGE' },
  });
  await db.judgeProfile.create({
    data: { eventMembershipId: membership.id, available: true },
  });
  const projects = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    const team = await db.team.create({
      data: {
        eventId: event.id,
        createdById: organizer.id,
        name: `${name} team`,
        slug: `${name}-${suffix}`,
      },
    });
    const project = await db.project.create({
      data: {
        eventId: event.id,
        teamId: team.id,
        name,
        slug: `${name}-${suffix}`,
        status: 'ACTIVE',
      },
    });
    const submission = await db.submission.create({
      data: {
        projectId: project.id,
        version: 1,
        title: `${name} frozen submission`,
        description: `${name} original immutable description`,
        projectName: name,
        projectTagline: `${name} frozen tagline`,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        createdById: organizer.id,
      },
    });
    projects.push({ ...project, submission });
  }
  return { eventId: event.id, organizer, judge, participant, projects };
}
async function login(page: Page, email: string, path: string) {
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
  );
}

test('organizer publishes, judge compares frozen submissions, ranking is immutable and becomes stale', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const f = await fixture();
  const orgContext = await browser.newContext();
  const judgeContext = await browser.newContext();
  const org = await orgContext.newPage();
  const judge = await judgeContext.newPage();
  try {
    await login(org, f.organizer.email, `/events/${f.eventId}/judging`);
    const section = org.getByRole('region', { name: 'Pairwise Mode' });
    await section
      .getByRole('button', { name: 'Create pairwise run', exact: true })
      .click();
    await expect(section.getByText('Run status: DRAFT')).toBeVisible();
    await section
      .getByRole('button', { name: 'Preview pairwise assignments' })
      .click();
    await expect(
      section.getByText('Assignment graph connected.'),
    ).toBeVisible();
    await section.getByText('Assignment preview and judge workload').click();
    await expect(section.getByText(/3 proposed, 0 existing/)).toBeVisible();
    await section
      .getByRole('button', { name: 'Publish pairwise assignments' })
      .click();
    await expect(section.getByText('Run status: PUBLISHED')).toBeVisible();
    await expect(
      section.getByText(
        'Global ranking unavailable because the comparison graph is disconnected.',
      ),
    ).toBeVisible();
    const refusal = org.waitForResponse(
      (r) => r.url().endsWith('/rankings') && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await section
      .getByRole('button', { name: 'Run Bradley–Terry ranking' })
      .click();
    expect((await refusal).status()).toBe(409);
    const count = await db.pairwiseRankingRun.count({
      where: { pairwiseRun: { eventId: f.eventId } },
    });
    expect(count).toBe(0);

    // A later live submission must never change the judge's pinned cards.
    for (const p of f.projects) {
      await db.project.update({
        where: { id: p.id },
        data: { name: `${p.name} live rename` },
      });
      await db.submission.create({
        data: {
          projectId: p.id,
          version: 2,
          title: `${p.name} NEW VERSION`,
          description: 'NEW MUTABLE MATERIAL',
          projectName: 'NEW NAME',
          status: 'SUBMITTED',
          submittedAt: new Date(),
          createdById: f.organizer.id,
        },
      });
    }
    await login(judge, f.judge.email, `/events/${f.eventId}/judge`);
    await judge.getByRole('link', { name: 'Open Pairwise Mode' }).click();
    await expect(
      judge.getByRole('heading', { name: 'Which project is stronger?' }),
    ).toBeVisible();
    await expect(
      judge.getByText('Immutable submission snapshot · version 1'),
    ).toHaveCount(2);
    await expect(judge.getByText('NEW MUTABLE MATERIAL')).toHaveCount(0);
    await expect(judge.getByRole('spinbutton')).toHaveCount(0);
    const workspaceResponse = await judge.request.get(
      `${webUrl}/api/events/${f.eventId}/judging/pairwise/workspace`,
    );
    const workspace = (await workspaceResponse.json()) as PairwiseWorkspace;
    const strengthOrder = new Map(f.projects.map((p, i) => [p.id, i]));
    for (let i = 0; i < 2; i++) {
      const a = workspace.assignments[i]!;
      await judge
        .getByLabel('Comparison', { exact: true })
        .selectOption(a.assignmentId);
      const side =
        strengthOrder.get(a.projectA.projectId)! <
        strengthOrder.get(a.projectB.projectId)!
          ? 'A'
          : 'B';
      await judge
        .getByRole('button', { name: `Choose Project ${side}`, exact: true })
        .click();
      await judge
        .getByRole('button', { name: 'Confirm and submit comparison' })
        .click();
      await expect(
        judge.getByText(/Comparison submitted — read-only/),
      ).toBeVisible();
      await expect(
        judge.getByRole('button', { name: 'Confirm and submit comparison' }),
      ).toHaveCount(0);
    }
    await expect(judge.getByText('2 of 3 comparisons completed')).toBeVisible();
    await section
      .getByRole('button', { name: 'Refresh pairwise progress' })
      .click();
    await expect(
      section.getByText('2 of 3 comparisons completed · 1 pending'),
    ).toBeVisible();
    await section
      .getByRole('button', { name: 'Run Bradley–Terry ranking' })
      .click();
    const ranking = section.getByRole('article', {
      name: 'Pairwise ranking results',
    });
    await expect(
      ranking.getByText(
        /BRADLEY_TERRY_RIDGE_V1 · lambda = 0.01 · connected graph/,
      ),
    ).toBeVisible();
    await ranking.getByText('Ranking diagnostics', { exact: true }).click();
    await expect(ranking.getByText(/Converged: true/)).toBeVisible();
    const firstRun = await db.pairwiseRankingRun.findFirstOrThrow({
      where: { pairwiseRun: { eventId: f.eventId } },
    });
    const last = workspace.assignments[2]!;
    await judge
      .getByLabel('Comparison', { exact: true })
      .selectOption(last.assignmentId);
    const side =
      strengthOrder.get(last.projectA.projectId)! <
      strengthOrder.get(last.projectB.projectId)!
        ? 'A'
        : 'B';
    await judge
      .getByRole('button', { name: `Choose Project ${side}`, exact: true })
      .click();
    await judge
      .getByRole('button', { name: 'Confirm and submit comparison' })
      .click();
    await expect(judge.getByText('3 of 3 comparisons completed')).toBeVisible();
    await section
      .getByRole('button', { name: 'Refresh pairwise progress' })
      .click();
    await expect(
      section.getByText(/Stale ranking: new comparisons/),
    ).toBeVisible();
    await section
      .getByRole('button', { name: 'Run Bradley–Terry ranking' })
      .click();
    await expect(
      ranking.getByText(
        '3 comparisons in snapshot · 3 currently submitted · 3 projects',
      ),
    ).toBeVisible();
    const rows = ranking.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++)
      await expect(rows.nth(i).locator('td').nth(1)).toHaveText(
        f.projects[i]!.name,
      );
    await section.getByLabel('Historical ranking').selectOption(firstRun.id);
    await expect(
      section.getByText(/Stale ranking: new comparisons/),
    ).toBeVisible();
    org.once('dialog', (d) => d.accept());
    await section.getByRole('button', { name: 'Close pairwise run' }).click();
    await expect(section.getByText('Run status: CLOSED')).toBeVisible();
    await org.screenshot({
      path: '/tmp/dogfood-b43-organizer.png',
      fullPage: true,
    });
    await judge.screenshot({
      path: '/tmp/dogfood-b43-judge.png',
      fullPage: true,
    });
  } finally {
    await orgContext.close().catch(() => undefined);
    await judgeContext.close().catch(() => undefined);
  }
});

test('participant cannot access pairwise organizer actions or judge evidence', async ({
  page,
}) => {
  const f = await fixture();
  await login(page, f.participant.email, `/events/${f.eventId}/judge/pairwise`);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'JUDGE_ACCESS_REQUIRED',
  );
  await expect(page.getByRole('article')).toHaveCount(0);
  const response = await page.request.post(
    `${webUrl}/api/events/${f.eventId}/judging/pairwise/runs`,
    { data: {}, headers: { Origin: webUrl } },
  );
  expect(response.status()).toBe(403);
});
