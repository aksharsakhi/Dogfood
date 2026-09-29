'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, message } from '../lib/client';

type Judge = { id: string; displayName: string; email: string };
type RecordItem = {
  id: string;
  judgeProfileId: string;
  assignmentCount: number;
  evaluationCount: number;
  issuedAt: string;
  issuerKeyId: string;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  supersedesRecordId: string | null;
  supersededByRecordId: string | null;
};
type Issued = { id: string; fingerprint: string };

export function JudgeRecordManager({ eventId }: { eventId: string }) {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [selectedJudge, setSelectedJudge] = useState('');
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const base = `/events/${eventId}`;

  const load = useCallback(async () => {
    const [judgeList, recordList] = await Promise.all([
      api<Judge[]>(`${base}/judging/judges`),
      api<RecordItem[]>(`${base}/judge-records`),
    ]);
    setJudges(judgeList);
    setRecords(recordList);
    setSelectedJudge((current) => current || judgeList[0]?.id || '');
  }, [base]);

  useEffect(() => {
    void load().catch((reason) => setError(message(reason)));
  }, [load]);

  async function run(action: () => Promise<void>) {
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const record = await api<Issued>(
        `${base}/judge-records/${selectedJudge}`,
        { method: 'POST', body: {} },
      );
      setNotice(`Signed judge record issued: ${record.id}`);
      await load();
    });
  }

  async function correct(recordId: string, judgeProfileId: string) {
    await run(async () => {
      const record = await api<Issued>(
        `${base}/judge-records/${judgeProfileId}`,
        { method: 'POST', body: { supersedesRecordId: recordId } },
      );
      setNotice(`Correction issued as new record ${record.id}.`);
      await load();
    });
  }

  async function revoke(recordId: string) {
    await run(async () => {
      await api(`${base}/judge-records/${recordId}/revoke`, {
        method: 'POST',
        body: {},
      });
      setNotice(
        'Signed revocation statement issued. The original record remains available.',
      );
      await load();
    });
  }

  async function participantCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const registrationUrl = `/api${base}/certificates/registration/${encodeURIComponent(userId)}`;
    window.open(registrationUrl, '_blank', 'noopener,noreferrer');
  }

  async function projectCertificate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = `/api${base}/certificates/projects/${encodeURIComponent(projectId)}/participants/${encodeURIComponent(userId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <main className="raptors-workspace-container">
      <div className="raptors-workspace-header">
        <span className="raptors-workspace-eyebrow">
          Trust & Cryptographic Records
        </span>
        <div className="raptors-workspace-title-row">
          <h1 className="raptors-workspace-title">Participation records</h1>
        </div>
        <p className="raptors-workspace-desc">
          Records describe stored DogFood registration, team membership,
          submissions, assignments, and submitted evaluations.
        </p>
      </div>

      <nav className="raptors-workspace-tabs" aria-label="Organizer navigation">
        <a href={`/events/${eventId}`} className="raptors-tab-item">
          Overview
        </a>
        <a href={`/events/${eventId}/manage`} className="raptors-tab-item">
          Settings
        </a>
        <a href={`/events/${eventId}/judging`} className="raptors-tab-item">
          Judging & Scoring
        </a>
        <a
          href={`/events/${eventId}/judging/records`}
          className="raptors-tab-item active"
        >
          Signed Records
        </a>
        <a
          href={`/events/${eventId}/voting/manage`}
          className="raptors-tab-item"
        >
          Voting
        </a>
        <a href={`/events/${eventId}/gallery`} className="raptors-tab-item">
          Gallery
        </a>
      </nav>

      <p style={{ display: 'none' }}>
        <a href={`/events/${eventId}/judging`}>Judging</a> ·{' '}
        <a href={`/events/${eventId}`}>Event page</a>
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}

      <section aria-label="Signed judge records" className="raptors-card-panel">
        <h2>Signed judge participation</h2>
        <form onSubmit={(event) => void issue(event)}>
          <label>
            Judge{' '}
            <select
              value={selectedJudge}
              onChange={(e) => setSelectedJudge(e.target.value)}
              required
            >
              {judges.map((judge) => (
                <option key={judge.id} value={judge.id}>
                  {judge.displayName} · {judge.email}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!selectedJudge}>Issue signed record</button>
        </form>
        {records.length ? (
          <ul>
            {records.map((record) => (
              <li key={record.id}>
                {judges.find((judge) => judge.id === record.judgeProfileId)
                  ?.displayName ?? 'Judge'}{' '}
                · {record.assignmentCount} assigned · {record.evaluationCount}{' '}
                submitted · {record.status} ·{' '}
                <a href={`/judge-records/${record.id}/verify`}>Verify</a> ·{' '}
                <a
                  href={`/api${base}/judge-records/${record.id}/certificate`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Print record
                </a>{' '}
                {record.status === 'ACTIVE' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void correct(record.id, record.judgeProfileId)
                      }
                    >
                      Issue correction
                    </button>{' '}
                    <button
                      type="button"
                      onClick={() => void revoke(record.id)}
                    >
                      Revoke
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No signed judge records have been issued.</p>
        )}
      </section>

      <section
        aria-label="Participant certificates"
        className="raptors-card-panel"
      >
        <h2>Participant records</h2>
        <form onSubmit={(event) => void participantCertificate(event)}>
          <label>
            Account user ID{' '}
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
            />
          </label>
          <button>Open registration record</button>
        </form>
        <form onSubmit={(event) => void projectCertificate(event)}>
          <label>
            Project ID{' '}
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            />
          </label>
          <button>Open project participation record</button>
        </form>
      </section>
    </main>
  );
}
