'use client';
import { useAuth } from '../lib/auth-context';
export function SessionNav() {
  const { user, logout } = useAuth();
  return (
    <nav aria-label="Account">
      <a href="/">Home</a>
      <a href="/events">Hackathons</a>
      {user ? (
        <>
          <a href="/events?mine=1">My events</a>
          <span>{user.displayName}</span>
          <button onClick={() => void logout()}>Log out</button>
        </>
      ) : (
        <>
          <a href="/login">Log in</a>
          <a href="/register">Register</a>
        </>
      )}
    </nav>
  );
}
