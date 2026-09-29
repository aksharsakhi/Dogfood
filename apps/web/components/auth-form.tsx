'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, message, User } from '../lib/client';

export function AuthForm({
  mode,
  initialNext,
}: {
  mode: 'login' | 'register';
  initialNext?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextParam, setNextParam] = useState<string | null>(
    initialNext ?? null,
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchVal = new URLSearchParams(window.location.search).get('next');
      if (searchVal && searchVal !== nextParam) {
        setNextParam(searchVal);
      }
    }
  }, [nextParam]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const body =
      mode === 'register'
        ? {
            email: String(data.get('email')),
            password: String(data.get('password')),
            displayName: String(data.get('displayName')),
          }
        : {
            email: String(data.get('email')),
            password: String(data.get('password')),
          };
    try {
      await api<User>(`/auth/${mode}`, { method: 'POST', body });
      const next =
        nextParam ??
        (typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('next')
          : null);
      const returnTo =
        next?.startsWith('/') && !next.startsWith('//') ? next : null;
      if (mode === 'register')
        router.push(
          returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login',
        );
      else {
        router.push(returnTo ?? '/events');
        router.refresh();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const switchUrl =
    mode === 'login'
      ? nextParam
        ? `/register?next=${encodeURIComponent(nextParam)}`
        : '/register'
      : nextParam
        ? `/login?next=${encodeURIComponent(nextParam)}`
        : '/login';

  const formSection = (
    <div className="raptors-auth-form-card">
      <div className="raptors-auth-card-header">
        <a href="/" className="raptors-auth-brand" aria-label="Raptors home">
          Raptors
        </a>
        <span className="raptors-auth-eyebrow">
          {mode === 'register' ? 'New Builder' : 'Account Access'}
        </span>
        <h1 className="raptors-auth-title">
          {mode === 'register' ? 'Create Account' : 'Log In'}
        </h1>
        <p className="raptors-auth-subtitle">
          {mode === 'register'
            ? 'Sign up to build, compete, and showcase verifiable projects.'
            : 'Enter your credentials to access your Raptors workspace.'}
        </p>
      </div>

      <form onSubmit={submit} className="raptors-auth-form">
        {mode === 'register' && (
          <div className="raptors-form-field">
            <label htmlFor="auth-display-name">Display name</label>
            <input
              id="auth-display-name"
              name="displayName"
              minLength={1}
              maxLength={100}
              placeholder="e.g. Alex Rivera"
              required
            />
          </div>
        )}

        <div className="raptors-form-field">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            placeholder="name@example.com"
            required
          />
        </div>

        <div className="raptors-form-field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            placeholder="••••••••••••"
            minLength={mode === 'register' ? 12 : 1}
            required
          />
          {mode === 'register' && (
            <span className="raptors-field-hint">
              Minimum 12 characters required.
            </span>
          )}
        </div>

        <button
          className="raptors-btn-primary btn-primary"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Working…' : mode === 'register' ? 'Register' : 'Log in'}
        </button>

        {error && (
          <p role="alert" className="raptors-auth-error">
            {error}
          </p>
        )}
      </form>

      <div className="raptors-auth-card-footer">
        {mode === 'login' ? (
          <p>
            Don&apos;t have an account?{' '}
            <a href={switchUrl} className="raptors-auth-link">
              Register →
            </a>
          </p>
        ) : (
          <p>
            Already have an account?{' '}
            <a href={switchUrl} className="raptors-auth-link">
              Log in →
            </a>
          </p>
        )}
      </div>
    </div>
  );

  const editorialSection = (
    <div className="raptors-auth-editorial-panel">
      <div className="raptors-auth-editorial-content">
        <span className="raptors-auth-editorial-label">
          {mode === 'login' ? 'Raptors Platform' : 'Start Building'}
        </span>
        <h2 className="raptors-auth-editorial-headline">
          {mode === 'login' ? (
            <>
              WELCOME
              <br />
              BACK.
            </>
          ) : (
            <>
              BUILD SOMETHING
              <br />
              WORTH REMEMBERING.
            </>
          )}
        </h2>
        <p className="raptors-auth-editorial-desc">
          {mode === 'login'
            ? 'Manage your hackathons, evaluate entries, submit projects, and inspect signed cryptographic certificates.'
            : 'Join serious builders, organizers, and judges across fair, verified events where ideas don’t go extinct.'}
        </p>
      </div>

      <div className="raptors-auth-editorial-scene" aria-hidden="true">
        <svg
          viewBox="0 0 460 220"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          {/* Moon with concentric rings */}
          <circle cx="340" cy="80" r="70" stroke="#1f1f1f" strokeWidth="1" />
          <circle cx="340" cy="80" r="50" stroke="#262626" strokeWidth="1" />
          <circle cx="340" cy="80" r="32" fill="#F7F7F4" />

          {/* Mountains */}
          <polygon points="60,185 160,115 260,185" fill="#222222" />
          <polygon points="180,185 280,100 380,185" fill="#1c1c1c" />
          <polygon points="300,185 390,110 460,185" fill="#252525" />
          <path
            d="M0 185 L80 150 L180 185 L270 140 L360 185 L460 155 L460 220 L0 220 Z"
            fill="#121212"
          />
          <line
            x1="0"
            y1="185"
            x2="460"
            y2="185"
            stroke="#262626"
            strokeWidth="1.5"
          />

          {/* Cacti */}
          <rect x="70" y="145" width="6" height="40" fill="#7a7a75" />
          <rect x="63" y="158" width="7" height="3" fill="#7a7a75" />
          <rect x="58" y="152" width="6" height="12" fill="#7a7a75" />
          <rect x="410" y="135" width="7" height="50" fill="#A5A5A0" />
          <rect x="402" y="152" width="8" height="4" fill="#A5A5A0" />
          <rect x="396" y="146" width="7" height="14" fill="#A5A5A0" />
        </svg>
      </div>
    </div>
  );

  return (
    <div className="raptors-auth-page">
      <div
        className={`raptors-auth-container ${mode === 'register' ? 'reverse' : ''}`}
      >
        {mode === 'login' ? (
          <>
            {editorialSection}
            {formSection}
          </>
        ) : (
          <>
            {formSection}
            {editorialSection}
          </>
        )}
      </div>
    </div>
  );
}
