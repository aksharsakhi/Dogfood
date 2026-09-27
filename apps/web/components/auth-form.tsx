'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, message, User } from '../lib/client';
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      const next = new URLSearchParams(window.location.search).get('next');
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
  return (
    <form onSubmit={submit}>
      <h1>{mode === 'register' ? 'Create account' : 'Log in'}</h1>
      {mode === 'register' && (
        <label>
          Display name
          <input name="displayName" minLength={1} maxLength={100} required />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          minLength={mode === 'register' ? 12 : 1}
          required
        />
      </label>
      <button disabled={busy}>
        {busy ? 'Working…' : mode === 'register' ? 'Register' : 'Log in'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
