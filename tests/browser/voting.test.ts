import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient, type VotingAccessMode } from '@prisma/client';
import { expect, test, type Browser, type Page } from '@playwright/test';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('T3C browser tests require an isolated _test database.');

const db = new PrismaClient();
const passwordHash = 'browser-fixture-not-for-login';
const webUrl = process.env.WEB_URL ?? 'http://localhost:3001';
type Person = { id: string; token: string };
type Fixture = {
  eventId: string;
  organizer: Person;
  owner: Person;
  voter: Person;
  ownProjectId: string;
  otherProjectId: string;
  ownTitle: string;
  otherTitle: string;
};

async function person(label: string): Promise<Person> {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await db.user.create({
    data: {
      id,
      email: `${label}-${id}@example.test`,
      displayName: label,
      passwordHash,
    },
  });
  await db.session.create({
    data: {
      userId: id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return { id, token };
}

async function fixture(): Promise<Fixture> {
  const organizer = await person('t3c-organizer');
  const owner = await person('t3c-owner');
  const voter = await person('t3c-voter');
  const eventId = randomUUID();
  const ownTitle = `Own project ${eventId.slice(0, 8)}`;
  const otherTitle = `Community project ${eventId.slice(0, 8)}`;
  await db.event.create({
    data: {
      id: eventId,
      slug: `t3c-${eventId}`,
      name: `T3C event ${eventId.slice(0, 8)}`,
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      galleryVisibility: 'PUBLIC',
      votingOpensAt: new Date(Date.now() - 2 * 3_600_000),
      votingClosesAt: new Date(Date.now() + 2 * 3_600_000),
    },
  });
  await db.eventMembership.createMany({
    data: [
      { eventId, userId: organizer.id, role: 'ORGANIZER' },
      { eventId, userId: owner.id, role: 'PARTICIPANT' },
      { eventId, userId: voter.id, role: 'PARTICIPANT' },
    ],
  });
  const ownTeamId = randomUUID();
  const otherTeamId = randomUUID();
  await db.team.createMany({
    data: [
      {
        id: ownTeamId,
        eventId,
        name: 'Voter team',
        slug: `voter-team-${ownTeamId}`,
        createdById: voter.id,
        status: 'ACTIVE',
      },
      {
        id: otherTeamId,
        eventId,
        name: 'Other team',
        slug: `other-team-${otherTeamId}`,
        createdById: owner.id,
        status: 'ACTIVE',
      },
    ],
  });
  await db.teamMember.createMany({
    data: [
      { eventId, teamId: ownTeamId, userId: voter.id, role: 'OWNER' },
      { eventId, teamId: otherTeamId, userId: owner.id, role: 'OWNER' },
    ],
  });
  const ownProjectId = randomUUID();
  const otherProjectId = randomUUID();
  for (const [id, teamId, title] of [
    [ownProjectId, ownTeamId, ownTitle],
    [otherProjectId, otherTeamId, otherTitle],
  ] as const) {
    await db.project.create({
      data: {
        id,
        eventId,
        teamId,
        name: title,
        slug: `project-${id}`,
        status: 'ACTIVE',
      },
    });
    await db.submission.create({
      data: {
        projectId: id,
        version: 1,
        title,
        description: `${title} submitted for community voting`,
        projectName: title,
        status: 'SUBMITTED',
        createdById: teamId === ownTeamId ? voter.id : owner.id,
        submittedAt: new Date(Date.now() - 3_600_000),
      },
    });
  }
  return {
    eventId,
    organizer,
    owner,
    voter,
    ownProjectId,
    otherProjectId,
    ownTitle,
    otherTitle,
  };
}

async function pageFor(
  browser: Browser,
  person?: Person,
  timezoneId = 'UTC',
): Promise<Page> {
  const context = await browser.newContext({ timezoneId });
  if (person)
    await context.addCookies([
      {
        name: 'dogfood_session',
        value: person.token,
        url: webUrl,
        httpOnly: true,
      },
    ]);
  return context.newPage();
}

async function configure(
  organizer: Page,
  eventId: string,
  mode: VotingAccessMode,
) {
  await organizer.goto(`/events/${eventId}/voting/manage`);
  await expect(
    organizer.getByRole('heading', { name: 'Voting configuration' }),
  ).toBeVisible();
  await expect(
    organizer.getByText('identifies a browser, not a person', { exact: false }),
  ).toBeVisible();
  await expect(
    organizer.getByText('control of the inbox is not proven', { exact: false }),
  ).toBeVisible();
  await expect(
    organizer.getByText('strongest identity guarantee', { exact: false }),
  ).toBeVisible();
  await organizer
    .getByRole('radio', {
      name: new RegExp(
        mode === 'OPEN'
          ? 'Open browser'
          : mode === 'EMAIL_GATED'
            ? 'Email-string'
            : 'Account ballot',
      ),
    })
    .check();
  await organizer
    .getByRole('button', { name: 'Save voting configuration' })
    .click();
  await expect(
    organizer.getByText('Voting configuration saved.'),
  ).toBeVisible();
  await expect(
    organizer.getByText('Selected:', { exact: false }),
  ).toContainText(
    mode === 'OPEN'
      ? 'Open browser ballot'
      : mode === 'EMAIL_GATED'
        ? 'Email-string ballot'
        : 'Account ballot',
  );
}

test.afterAll(async () => {
  await db.$disconnect();
});

test('organizer window round-trips across device timezones as one UTC instant', async ({
  browser,
}) => {
  const f = await fixture();
  const india = await pageFor(browser, f.organizer, 'Asia/Kolkata');
  await india.goto(`/events/${f.eventId}/voting/manage`);
  const opens = india.getByLabel('Voting opens');
  const closes = india.getByLabel('Voting closes');
  await expect(opens).toHaveValue(/\d{4}-\d\d-\d\dT\d\d:\d\d/);
  await opens.fill('2030-01-02T10:15');
  await closes.fill('2030-01-02T11:15');
  await india
    .getByRole('button', { name: 'Save voting configuration' })
    .click();
  await expect(india.getByText('Voting configuration saved.')).toBeVisible();
  const event = await db.event.findUniqueOrThrow({ where: { id: f.eventId } });
  expect(event.votingOpensAt?.toISOString()).toBe('2030-01-02T04:45:00.000Z');
  expect(event.votingClosesAt?.toISOString()).toBe('2030-01-02T05:45:00.000Z');
  await expect(opens).toHaveValue('2030-01-02T10:15');
  await expect(closes).toHaveValue('2030-01-02T11:15');

  const pacific = await pageFor(browser, f.organizer, 'America/Los_Angeles');
  await pacific.goto(`/events/${f.eventId}/voting/manage`);
  await expect(pacific.getByLabel('Voting opens')).toHaveValue(
    '2030-01-01T20:45',
  );
  await expect(pacific.getByLabel('Voting closes')).toHaveValue(
    '2030-01-01T21:45',
  );
});

for (const mode of ['OPEN', 'EMAIL_GATED', 'AUTHENTICATED'] as const) {
  test(`${mode} voting journey: configure, vote, moderate, hide then release results`, async ({
    browser,
  }) => {
    const f = await fixture();
    const organizer = await pageFor(browser, f.organizer);
    const voter = await pageFor(
      browser,
      mode === 'AUTHENTICATED' ? f.voter : undefined,
    );
    const publicPage = await pageFor(browser);
    await configure(organizer, f.eventId, mode);

    await voter.goto(`/events/${f.eventId}/vote`);
    if (mode === 'OPEN') {
      await expect(
        voter.getByRole('heading', { name: 'Browser-based ballot' }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          (await voter.context().cookies()).some((cookie) =>
            cookie.name.startsWith('dogfood_voter_'),
          ),
        )
        .toBe(true);
      const tokenCookie = (await voter.context().cookies()).find((cookie) =>
        cookie.name.startsWith('dogfood_voter_'),
      )!;
      expect(tokenCookie.httpOnly).toBe(true);
      expect(tokenCookie.sameSite).toBe('Lax');
      expect(tokenCookie.path).toBe(`/api/events/${f.eventId}/voting`);
      expect(tokenCookie.value).toMatch(/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/);
      await expect(
        voter.getByText('Browser voting identity ready on this device.'),
      ).toBeVisible();
    }
    if (mode === 'EMAIL_GATED') {
      await expect(
        voter.getByText('does not prove control of the inbox', {
          exact: false,
        }),
      ).toBeVisible();
      await voter.getByLabel('Email address').fill('voter@example.test');
      await voter
        .getByRole('button', { name: 'Open email-string ballot' })
        .click();
    }
    if (mode === 'AUTHENTICATED')
      await expect(
        voter.getByText(
          'You cannot vote for a project submitted by your own team.',
        ),
      ).toBeVisible();
    await expect(
      voter.getByRole('heading', { name: 'Projects on your ballot' }),
    ).toBeVisible();
    if (mode === 'AUTHENTICATED') {
      await voter
        .getByRole('button', { name: `Vote for ${f.ownTitle}` })
        .click();
      await expect(
        voter
          .getByRole('alert')
          .getByText(
            'You cannot vote for a project submitted by your own team.',
          ),
      ).toBeVisible();
    }
    await voter
      .getByRole('button', { name: `Vote for ${f.otherTitle}` })
      .click();
    await expect(
      voter.getByRole('heading', { name: 'Vote recorded' }),
    ).toBeVisible();

    const duplicate = await voter.request.post(
      `${webUrl}/api/events/${f.eventId}/voting/votes`,
      {
        headers: { Origin: webUrl },
        data: {
          projectId: f.otherProjectId,
          ...(mode === 'EMAIL_GATED' ? { email: 'voter@example.test' } : {}),
        },
      },
    );
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).code).toBe('ALREADY_VOTED');
    await voter.reload();
    if (mode === 'EMAIL_GATED') {
      await voter.getByLabel('Email address').fill('voter@example.test');
      await voter
        .getByRole('button', { name: 'Open email-string ballot' })
        .click();
    }
    await expect(
      voter.getByRole('heading', { name: 'Already voted' }),
    ).toBeVisible();
    await expect(
      voter.getByRole('heading', { name: 'Projects on your ballot' }),
    ).toHaveCount(0);

    await publicPage.goto(`/events/${f.eventId}/voting/results`);
    await expect(
      publicPage.getByRole('heading', { name: 'Results are not yet public' }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole('heading', { name: 'Vote tallies' }),
    ).toHaveCount(0);

    await voter.goto(`/events/${f.eventId}/gallery/${f.otherProjectId}`);
    if (mode === 'EMAIL_GATED')
      await voter.getByLabel('Email address').fill('voter@example.test');
    await voter
      .getByRole('textbox', { name: 'Comment', exact: true })
      .fill(`A thoughtful ${mode} comment`);
    await voter.getByRole('button', { name: 'Post comment' }).click();
    await expect(voter.getByText(`A thoughtful ${mode} comment`)).toBeVisible();
    await organizer.goto(`/events/${f.eventId}/gallery/${f.otherProjectId}`);
    await organizer.getByRole('button', { name: 'Hide comment' }).click();
    await expect(organizer.getByText('Comment hidden.')).toBeVisible();
    await voter.reload();
    await expect(voter.getByText(`A thoughtful ${mode} comment`)).toHaveCount(
      0,
    );

    await organizer.goto(`/events/${f.eventId}/voting/manage`);
    await expect(
      organizer.getByText('Access mode locked.', { exact: false }),
    ).toBeVisible();
    await expect(
      organizer.getByRole('radio', { name: /Open browser ballot/ }),
    ).toBeDisabled();
    await expect(
      organizer.getByRole('heading', { name: 'Live community tallies' }),
    ).toBeVisible();
    await expect(organizer.getByText('1 votes')).toBeVisible();
    const pastClose = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    await organizer.getByLabel('Voting closes').fill(pastClose);
    await organizer
      .getByRole('button', { name: 'Save voting configuration' })
      .click();
    await expect(
      organizer.getByText('Voting configuration saved.'),
    ).toBeVisible();
    await publicPage.getByRole('button', { name: 'Refresh results' }).click();
    await expect(
      publicPage.getByRole('heading', { name: 'Vote tallies' }),
    ).toBeVisible();
    await expect(publicPage.getByText('1 votes')).toBeVisible();
  });
}

test('repeated authenticated self-votes show the rate-limit retry signal', async ({
  browser,
}) => {
  const f = await fixture();
  const organizer = await pageFor(browser, f.organizer);
  const voter = await pageFor(browser, f.voter);
  await configure(organizer, f.eventId, 'AUTHENTICATED');
  await voter.goto(`/events/${f.eventId}/vote`);
  const button = voter.getByRole('button', { name: `Vote for ${f.ownTitle}` });
  await expect(button).toBeVisible();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await button.click();
    await expect(
      voter.getByRole('alert').filter({ hasText: 'You cannot vote' }),
    ).toContainText(
      'You cannot vote for a project submitted by your own team.',
    );
  }
  await button.click();
  await expect(
    voter.getByRole('alert').filter({ hasText: 'Too many attempts' }),
  ).toContainText(/Try again in \d+ seconds/);
});

test('related OPEN ballots surface a flagged organizer audit entry', async ({
  browser,
}) => {
  const f = await fixture();
  const organizer = await pageFor(browser, f.organizer);
  await configure(organizer, f.eventId, 'OPEN');
  const first = await pageFor(browser);
  const second = await pageFor(browser);
  for (const voter of [first, second]) {
    await voter.goto(`/events/${f.eventId}/vote`);
    await voter
      .getByRole('button', { name: `Vote for ${f.otherTitle}` })
      .click();
    await expect(
      voter.getByRole('heading', { name: 'Vote recorded' }),
    ).toBeVisible();
  }
  await organizer.getByRole('button', { name: 'Refresh activity' }).click();
  await organizer.getByLabel('Filter loaded activity').selectOption('flags');
  await expect(
    organizer.getByText('Voting pattern flagged for organizer review'),
  ).toBeVisible();
  await expect(
    organizer.getByText('Related identities voted within ten seconds'),
  ).toBeVisible();
});

test('public comments load later cursor pages without showing hidden comments', async ({
  browser,
}) => {
  const f = await fixture();
  const identity = await db.votingIdentity.create({
    data: {
      eventId: f.eventId,
      mode: 'AUTHENTICATED',
      userId: f.voter.id,
    },
  });
  const createdAt = new Date(Date.now() - 30_000);
  await db.projectComment.createMany({
    data: Array.from({ length: 26 }, (_, index) => ({
      eventId: f.eventId,
      projectId: f.otherProjectId,
      identityId: identity.id,
      body: `Cursor comment ${index}`,
      createdAt,
      ...(index === 13
        ? {
            status: 'HIDDEN' as const,
            hiddenAt: createdAt,
            hiddenById: f.organizer.id,
          }
        : {}),
    })),
  });
  const viewer = await pageFor(browser);
  await viewer.goto(`/events/${f.eventId}/gallery/${f.otherProjectId}`);
  await expect(
    viewer.getByRole('button', { name: 'Load more comments' }),
  ).toBeVisible();
  await expect(viewer.locator('.voting-comment-list li')).toHaveCount(20);
  await viewer.getByRole('button', { name: 'Load more comments' }).click();
  await expect(viewer.locator('.voting-comment-list li')).toHaveCount(25);
  await expect(viewer.getByText('Cursor comment 13')).toHaveCount(0);
  await expect(
    viewer.getByRole('button', { name: 'Load more comments' }),
  ).toHaveCount(0);
});
