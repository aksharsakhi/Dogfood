'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api } from '../lib/client';

type OwnJudgeRecord = {
  id: string;
  assignmentCount: number;
  evaluationCount: number;
  status: string;
  issuedAt: string;
};

export function ParticipationRecords({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const [judgeRecords, setJudgeRecords] = useState<OwnJudgeRecord[]>([]);
  useEffect(() => {
    if (!user) {
      setJudgeRecords([]);
      return;
    }
    void api<OwnJudgeRecord[]>(`/events/${eventId}/judge-records/me`).then(
      setJudgeRecords,
      () => setJudgeRecords([]),
    );
  }, [eventId, user]);
  return (
    <main>
      <h1>Your participation records</h1>
      <p>
        These printable records describe account registration, submitted project
        snapshots, and judge work recorded by DogFood. They do not certify
        attendance, results, or verified real-world identity.
      </p>
      <section aria-label="Your records">
        <h2>Participant records</h2>
        <ul>
          <li>
            <a href={`/api/events/${eventId}/certificates/registration/me`}>
              Open registration record
            </a>
          </li>
          <li>
            <a href={`/api/events/${eventId}/certificates/projects/me`}>
              Open submitted project participation records
            </a>
          </li>
        </ul>
        <p>Use your browser’s print command to save a PDF if needed.</p>
      </section>
      <section aria-label="Your judge records">
        <h2>Judge records</h2>
        <p>
          <a href={`/events/${eventId}/judge`}>Judge workspace</a>
        </p>
        {judgeRecords.length ? (
          <ul>
            {judgeRecords.map((record) => (
              <li key={record.id}>
                {record.assignmentCount} assigned · {record.evaluationCount}{' '}
                submitted · {record.status} ·{' '}
                <a
                  href={`/api/events/${eventId}/judge-records/${record.id}/certificate`}
                >
                  Print record
                </a>{' '}
                ·{' '}
                <a href={`/judge-records/${record.id}/verify`}>
                  Verify publicly
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No judge records are available for this account.</p>
        )}
      </section>
      <p>
        <a href={`/events/${eventId}`}>Back to event</a>
      </p>
    </main>
  );
}
