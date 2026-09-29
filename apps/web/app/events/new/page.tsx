'use client';

import { useAuth } from '../../../lib/auth-context';
import { EventEditor } from '../../../components/event-editor';

export default function NewEventPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="raptors-auth-gated-page">
        <div className="raptors-auth-gated-card">
          <span className="raptors-section-eyebrow">Organizer Suite</span>
          <h1 className="raptors-auth-gated-title">HOST A HACKATHON</h1>
          <p className="raptors-auth-gated-desc">
            To create and manage a hackathon with verified judging, automated
            pairwise allocations, and portable ZIP archive exports, please sign
            in with your organizer credentials.
          </p>
          <div className="raptors-auth-gated-actions">
            <a
              href="/login?next=%2Fevents%2Fnew"
              className="raptors-btn-primary btn-primary"
            >
              Sign In to Continue →
            </a>
            <a
              href="/register?next=%2Fevents%2Fnew"
              className="raptors-btn-secondary btn-secondary"
            >
              Create Account →
            </a>
          </div>
          <div className="raptors-auth-gated-sub">
            <a href="/events/archive" className="raptors-text-link">
              Looking to restore an event? Import an event archive ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="raptors-host-page-container">
      <div className="raptors-host-page-header">
        <div>
          <span className="raptors-section-eyebrow">Organizer Workspace</span>
          <h1 className="raptors-host-title">HOST A HACKATHON</h1>
          <p className="raptors-host-subtitle">
            Configure your hackathon parameters, participation limits, and event
            timeline.
          </p>
        </div>
        <div>
          <a
            href="/events/archive"
            className="raptors-btn-secondary btn-secondary"
          >
            Import an event archive ↗
          </a>
        </div>
      </div>

      <EventEditor />
    </div>
  );
}
