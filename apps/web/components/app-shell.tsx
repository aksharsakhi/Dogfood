'use client';
import { usePathname } from 'next/navigation';
import { SessionNav } from './session-nav';
import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isAuth = pathname === '/login' || pathname === '/register';

  if (isLanding || isAuth) {
    // Landing and Auth pages manage their own complete canvas
    return <>{children}</>;
  }

  return (
    <div className="raptors-app-shell">
      <header
        className="raptors-top-nav brand-header"
        aria-label="Main navigation"
      >
        <div className="raptors-nav-inner">
          <div className="raptors-nav-left brand-logo-group">
            <a
              href="/"
              className="raptors-brand brand-title"
              aria-label="Raptors home"
            >
              Raptors
            </a>
            <nav className="raptors-nav-links" aria-label="Product navigation">
              <a href="/events" className="lp-nav-link nav-link">
                Explore
              </a>
              <a href="/events/new" className="lp-nav-link nav-link">
                Organize
              </a>
              <a href="/events" className="lp-nav-link nav-link">
                Judging
              </a>
            </nav>
          </div>

          <SessionNav />
        </div>
      </header>

      <div className="raptors-main-content">{children}</div>

      <footer className="raptors-footer brand-footer" aria-label="Site footer">
        <div className="raptors-footer-inner footer-content">
          <div className="raptors-footer-left footer-brand">
            <span className="raptors-footer-brand footer-logo">Raptors</span>
            <span className="raptors-footer-byline footer-byline">
              by Hackathon Raptors
            </span>
            <p className="raptors-footer-tagline footer-tagline">
              Ideas don&apos;t go extinct.
            </p>
          </div>

          <nav
            className="raptors-footer-links footer-links"
            aria-label="Footer navigation"
          >
            <a href="/events">Explore</a>
            <a href="/events/new">Organize</a>
            <a href="/events">Judging</a>
            <a href="/#about">About</a>
            <a href="/api/openapi.json">API Spec</a>
          </nav>
        </div>

        <div className="raptors-footer-copy footer-bottom">
          © {new Date().getFullYear()} Hackathon Raptors. Open source · Verified
          records · Built for fair judging.
        </div>
      </footer>
    </div>
  );
}
