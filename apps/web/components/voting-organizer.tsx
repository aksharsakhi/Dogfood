'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type CommunityResults,
  type VotingAuditItem,
  type VotingAuditPage,
  type VotingConfig,
  type VotingMode,
  votingErrorMessage,
  votingRequest,
  votingTime,
} from '../lib/voting';

const modes: Array<{ mode: VotingMode; title: string; description: string }> = [
  {
    mode: 'OPEN',
    title: 'Open browser ballot',
    description:
      'No login or email is needed. A browser token identifies a browser, not a person; clearing cookies or using another browser can obtain another vote.',
  },
  {
    mode: 'EMAIL_GATED',
    title: 'Email-string ballot',
    description:
      'A voter enters an email address. One vote is allowed per normalized email string. No email is sent, and control of the inbox is not proven.',
  },
  {
    mode: 'AUTHENTICATED',
    title: 'Account ballot',
    description:
      'A voter logs in with an existing account. This is the strongest identity guarantee here; voting for a project submitted by their own team is blocked.',
  },
];

const filters = [
  { value: 'all', label: 'All activity' },
  { value: 'flags', label: 'Flagged patterns' },
  { value: 'votes', label: 'Votes' },
  { value: 'comments', label: 'Comments' },
  { value: 'config', label: 'Configuration' },
];

function localInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function auditMatches(item: VotingAuditItem, filter: string): boolean {
  if (filter === 'flags') return item.action === 'COMMUNITY_VOTE_FLAGGED';
  if (filter === 'votes') return item.action === 'COMMUNITY_VOTE_CAST';
  if (filter === 'comments') return item.action.startsWith('PROJECT_COMMENT_');
  if (filter === 'config')
    return ['VOTING_CONFIG_CHANGED', 'EVENT_UPDATED'].includes(item.action);
  return true;
}

export function VotingOrganizer({ eventId }: { eventId: string }) {
  const base = `/events/${eventId}/voting`;
  const [config, setConfig] = useState<VotingConfig | null>(null);
  const [mode, setMode] = useState<VotingMode>('AUTHENTICATED');
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [results, setResults] = useState<CommunityResults | null>(null);
  const [audit, setAudit] = useState<VotingAuditItem[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const refreshConfig = useCallback(async () => {
    const next = await votingRequest<VotingConfig>(`${base}/config`);
    setConfig(next);
    setMode(next.accessMode);
    setOpens(localInput(next.votingOpensAt));
    setCloses(localInput(next.votingClosesAt));
  }, [base]);

  const refreshResults = useCallback(async () => {
    setResults(await votingRequest<CommunityResults>(`${base}/results`));
  }, [base]);

  const loadAudit = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ pageSize: '20' });
      if (cursor) params.set('cursor', cursor);
      const page = await votingRequest<VotingAuditPage>(
        `${base}/audit?${params}`,
      );
      setAudit((old) => (cursor ? [...old, ...page.items] : page.items));
      setAuditCursor(page.nextCursor);
    },
    [base],
  );

  useEffect(() => {
    void Promise.all([refreshConfig(), refreshResults(), loadAudit()]).catch(
      (cause: unknown) => setError(votingErrorMessage(cause)),
    );
  }, [refreshConfig, refreshResults, loadAudit]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await votingRequest<VotingConfig>(`${base}/config`, {
        method: 'PATCH',
        body: {
          accessMode: mode,
          votingOpensAt: new Date(opens).toISOString(),
          votingClosesAt: new Date(closes).toISOString(),
        },
      });
      await refreshConfig();
      await refreshResults();
      await loadAudit();
      setNotice('Voting configuration saved.');
    } catch (cause) {
      setError(votingErrorMessage(cause, config ?? undefined));
      await refreshConfig().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  const visibleAudit = audit.filter((item) => auditMatches(item, filter));

  return (
    <main>
      <p className="eyebrow">Organizer controls · Community voting</p>
      <h1>Voting and integrity</h1>
      <p>
        <a href={`/events/${eventId}/manage`}>Event settings</a> ·{' '}
        <a href={`/events/${eventId}/vote`}>Open public ballot</a> ·{' '}
        <a href={`/events/${eventId}/voting/results`}>Public results view</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <section aria-labelledby="voting-config-heading">
        <h2 id="voting-config-heading">Voting configuration</h2>
        {!config ? (
          <p>Loading configuration…</p>
        ) : (
          <form onSubmit={(event) => void save(event)}>
            <fieldset>
              <legend>Who can vote?</legend>
              {config.votingConfigLocked && (
                <p role="status" className="voting-lock-note">
                  Access mode locked. A voting identity already exists for this
                  event, so the mode cannot change. You can still edit the
                  voting window.
                </p>
              )}
              <div className="voting-mode-grid">
                {modes.map((choice) => (
                  <label className="voting-mode-card" key={choice.mode}>
                    <span className="voting-mode-heading">
                      <input
                        type="radio"
                        name="votingAccessMode"
                        value={choice.mode}
                        checked={mode === choice.mode}
                        disabled={config.votingConfigLocked}
                        onChange={() => setMode(choice.mode)}
                      />
                      {choice.title}
                    </span>
                    <span className="voting-mode-description">
                      {choice.description}
                    </span>
                  </label>
                ))}
              </div>
              <p className="voting-selected-mode">
                Selected: {modes.find((choice) => choice.mode === mode)?.title}
              </p>
            </fieldset>
            <fieldset>
              <legend>Voting window</legend>
              <p>Enter times in your device’s local timezone.</p>
              <label>
                Voting opens
                <input
                  type="datetime-local"
                  value={opens}
                  onChange={(event) => setOpens(event.target.value)}
                  required
                />
              </label>
              <label>
                Voting closes
                <input
                  type="datetime-local"
                  value={closes}
                  onChange={(event) => setCloses(event.target.value)}
                  required
                />
              </label>
              <p>
                Current window: {votingTime(config.votingOpensAt)} –{' '}
                {votingTime(config.votingClosesAt)}
              </p>
            </fieldset>
            <button disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save voting configuration'}
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="community-results-heading">
        <h2 id="community-results-heading">Live community tallies</h2>
        <p>Organizer view. Public results stay hidden until voting closes.</p>
        <button
          type="button"
          onClick={() =>
            void refreshResults().catch((cause: unknown) =>
              setError(votingErrorMessage(cause)),
            )
          }
        >
          Refresh tallies
        </button>
        {results ? (
          results.items.length ? (
            <ul className="voting-tally-list">
              {results.items.map((item) => (
                <li key={item.projectId}>
                  <span>{item.title}</span>
                  <strong>{item.votes} votes</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>No eligible submitted projects yet.</p>
          )
        ) : (
          <p>Loading tallies…</p>
        )}
      </section>

      <section aria-labelledby="voting-audit-heading">
        <h2 id="voting-audit-heading">Voting audit</h2>
        <p>
          Votes, comments, moderation, configuration, and patterns flagged for
          review.
        </p>
        <button
          type="button"
          onClick={() =>
            void loadAudit().catch((cause: unknown) =>
              setError(votingErrorMessage(cause)),
            )
          }
        >
          Refresh activity
        </button>
        <label>
          Filter loaded activity
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {filters.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {visibleAudit.length ? (
          <ul className="voting-audit-list">
            {visibleAudit.map((item) => (
              <li
                key={item.id}
                className={
                  item.action === 'COMMUNITY_VOTE_FLAGGED'
                    ? 'voting-audit-flag'
                    : undefined
                }
              >
                <strong>
                  {item.action === 'COMMUNITY_VOTE_FLAGGED' ? '⚑ ' : ''}
                  {item.description}
                </strong>
                <span>{votingTime(item.createdAt)}</span>
                {item.action === 'COMMUNITY_VOTE_FLAGGED' &&
                  item.metadata?.reason && <p>{item.metadata.reason}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p>No matching activity in the loaded pages.</p>
        )}
        {auditCursor && (
          <button
            type="button"
            onClick={() =>
              void loadAudit(auditCursor).catch((cause: unknown) =>
                setError(votingErrorMessage(cause)),
              )
            }
          >
            Load older activity
          </button>
        )}
      </section>
    </main>
  );
}
