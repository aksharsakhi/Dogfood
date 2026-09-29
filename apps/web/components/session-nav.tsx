'use client';
import { useAuth } from '../lib/auth-context';

export function SessionNav() {
  const { user, logout } = useAuth();
  return (
    <nav aria-label="Account" className="lp-session-nav main-nav">
      {user ? (
        <div className="lp-user-menu-group user-menu-group">
          <a
            href="/events?mine=1"
            className="lp-nav-link lp-nav-link-highlight nav-link nav-link-highlight"
          >
            My events
          </a>
          <span className="lp-user-badge user-badge">{user.displayName}</span>
          <button
            className="lp-btn-logout btn-secondary btn-sm"
            onClick={() => void logout()}
          >
            Log out
          </button>
        </div>
      ) : (
        <div className="lp-auth-btn-group auth-btn-group">
          <a href="/login" className="lp-nav-signin">
            Sign in
          </a>
          <a href="/register" className="lp-btn-cta">
            Get Started
            <span className="lp-btn-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      )}
    </nav>
  );
}
