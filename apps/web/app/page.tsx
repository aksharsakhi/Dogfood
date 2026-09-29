'use client';

import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   HERO ENVIRONMENT SVG
   Pixel cacti, drifting clouds, rocks, and ground baseline.
   ViewBox 0 0 1400 110  |  Horizon at y=68
   ═══════════════════════════════════════════════════════════════ */
function HeroEnvironmentSvg() {
  return (
    <svg
      viewBox="0 0 1400 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* Ground horizon line */}
      <line
        x1="0"
        y1="68"
        x2="1400"
        y2="68"
        stroke="#B8B8B3"
        strokeWidth="1.5"
      />

      {/* ─ PIXEL CLOUDS (DRIFT ANIMATED) ─ */}
      <g className="lp-cloud-drift-1">
        {/* Upper Left Cloud */}
        <rect x="130" y="16" width="20" height="7" fill="#DADAD6" />
        <rect x="124" y="23" width="32" height="7" fill="#DADAD6" />
        <rect x="120" y="30" width="40" height="7" fill="#DADAD6" />
        <rect x="126" y="37" width="28" height="5" fill="#DADAD6" />

        {/* Lower Left Mid Cloud */}
        <rect x="52" y="52" width="16" height="5" fill="#E5E5E1" />
        <rect x="46" y="57" width="26" height="5" fill="#E5E5E1" />
        <rect x="50" y="62" width="18" height="3" fill="#E5E5E1" />
      </g>

      <g className="lp-cloud-drift-2">
        {/* Upper Right Small Cloud */}
        <rect x="890" y="14" width="16" height="5" fill="#E5E5E1" />
        <rect x="886" y="19" width="24" height="5" fill="#E5E5E1" />
        <rect x="890" y="24" width="16" height="4" fill="#E5E5E1" />

        {/* Far Right Stepped Cloud */}
        <rect x="1240" y="44" width="24" height="7" fill="#DADAD6" />
        <rect x="1234" y="51" width="36" height="7" fill="#DADAD6" />
        <rect x="1230" y="58" width="44" height="7" fill="#DADAD6" />
        <rect x="1236" y="65" width="32" height="3" fill="#DADAD6" />
      </g>

      {/* ─ LEFT CACTUS LARGE (left of 'R') ─ */}
      <rect x="220" y="18" width="8" height="50" fill="#383838" />
      <rect x="210" y="36" width="10" height="4" fill="#383838" />
      <rect x="202" y="30" width="8" height="20" fill="#383838" />
      <rect x="228" y="44" width="10" height="4" fill="#383838" />
      <rect x="238" y="38" width="8" height="18" fill="#383838" />

      {/* ─ MIDDLE CACTUS SMALL (under 'p') ─ */}
      <rect x="450" y="44" width="6" height="24" fill="#383838" />
      <rect x="444" y="52" width="6" height="4" fill="#383838" />
      <rect x="438" y="48" width="6" height="12" fill="#383838" />

      {/* ─ RIGHT CACTUS MEDIUM (right of 's') ─ */}
      <rect x="1030" y="26" width="7" height="42" fill="#383838" />
      <rect x="1022" y="40" width="8" height="4" fill="#383838" />
      <rect x="1016" y="36" width="6" height="14" fill="#383838" />
      <rect x="1037" y="46" width="7" height="4" fill="#383838" />
      <rect x="1044" y="42" width="6" height="12" fill="#383838" />

      {/* ─ FAR RIGHT CACTUS SMALL ─ */}
      <rect x="1160" y="46" width="6" height="22" fill="#383838" />
      <rect x="1154" y="54" width="6" height="4" fill="#383838" />
      <rect x="1148" y="50" width="6" height="10" fill="#383838" />

      {/* ─ TERRAIN ROCKS & DOTS ─ */}
      <rect x="90" y="65" width="8" height="3" fill="#CFCFCB" />
      <rect x="330" y="65" width="10" height="3" fill="#CFCFCB" />
      <rect x="332" y="62" width="6" height="3" fill="#BFC0BC" />
      <rect x="580" y="66" width="12" height="2" fill="#DADAD6" />
      <rect x="740" y="65" width="8" height="3" fill="#CFCFCB" />
      <rect x="940" y="65" width="14" height="3" fill="#CFCFCB" />
      <rect x="944" y="62" width="6" height="3" fill="#BFC0BC" />
      <rect x="1100" y="66" width="10" height="2" fill="#DADAD6" />
      <rect x="1310" y="65" width="8" height="3" fill="#CFCFCB" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DARK DESERT SCENE SVG
   Large moon, concentric rings, mountain silhouettes, desert cacti.
   ViewBox 0 0 560 460
   ═══════════════════════════════════════════════════════════════ */
function DesertSceneSvg() {
  return (
    <svg
      viewBox="0 0 560 460"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ width: '100%', height: 'auto' }}
    >
      {/* ─ CONCENTRIC ORBIT RINGS ─ */}
      <circle cx="340" cy="180" r="185" stroke="#1d1d1d" strokeWidth="1" />
      <circle cx="340" cy="180" r="162" stroke="#242424" strokeWidth="1.2" />
      <circle cx="340" cy="180" r="140" stroke="#2d2d2d" strokeWidth="1.5" />

      {/* ─ LARGE SOLID MOON CIRCLE ─ */}
      <circle cx="340" cy="180" r="115" fill="#F7F7F4" />

      {/* ─ AMBIENT STAR DUST ─ */}
      <rect x="40" y="60" width="3" height="3" fill="#383838" />
      <rect x="80" y="110" width="2" height="2" fill="#2d2d2d" />
      <rect x="180" y="45" width="3" height="3" fill="#383838" />
      <rect x="520" y="90" width="2" height="2" fill="#2d2d2d" />
      <rect x="535" y="160" width="3" height="3" fill="#383838" />

      {/* ─ PIXEL CLOUDS ─ */}
      <g className="lp-cloud-drift-1">
        <rect x="110" y="60" width="20" height="7" fill="#242424" />
        <rect x="104" y="67" width="32" height="7" fill="#242424" />
        <rect x="100" y="74" width="40" height="7" fill="#242424" />
        <rect x="106" y="81" width="28" height="4" fill="#242424" />
      </g>

      {/* ─ DISTANT MOUNTAIN SILHOUETTE (MID-GRAY) ─ */}
      <polygon points="140,380 230,280 320,380" fill="#2a2a2a" />
      <polygon points="270,380 370,230 470,380" fill="#323232" />
      <polygon points="410,380 490,290 550,380" fill="#282828" />

      {/* ─ MIDGROUND MOUNTAINS (DARK CHARCOAL) ─ */}
      <polygon points="80,380 180,260 280,380" fill="#1e1e1e" />
      <polygon points="230,380 310,290 390,380" fill="#181818" />
      <polygon points="340,380 430,270 520,380" fill="#1c1c1c" />

      {/* ─ FOREGROUND MOUNTAIN RIDGE ─ */}
      <path
        d="M0 380 L60 320 L130 380 L220 310 L300 380 L380 330 L450 380 L520 340 L560 380 L560 410 L0 410 Z"
        fill="#141414"
      />

      {/* ─ BASELINE GROUND ─ */}
      <rect x="0" y="380" width="560" height="80" fill="#090909" />
      <line
        x1="0"
        y1="380"
        x2="560"
        y2="380"
        stroke="#2c2c2c"
        strokeWidth="2"
      />

      {/* Ground stepping pixel stones */}
      <rect x="0" y="376" width="18" height="4" fill="#222222" />
      <rect x="36" y="374" width="12" height="6" fill="#262626" />
      <rect x="80" y="376" width="22" height="4" fill="#222222" />
      <rect x="180" y="374" width="16" height="6" fill="#262626" />
      <rect x="280" y="376" width="20" height="4" fill="#222222" />
      <rect x="340" y="374" width="16" height="6" fill="#262626" />
      <rect x="460" y="376" width="24" height="4" fill="#222222" />
      <rect x="520" y="374" width="18" height="6" fill="#262626" />

      {/* ─ RIGHT CACTUS SMALL ─ */}
      <rect x="430" y="342" width="6" height="38" fill="#7a7a75" />
      <rect x="424" y="354" width="6" height="4" fill="#7a7a75" />
      <rect x="418" y="350" width="6" height="12" fill="#7a7a75" />

      {/* ─ RIGHT CACTUS LARGE (TALL SILHOUETTE) ─ */}
      <rect x="496" y="300" width="10" height="80" fill="#A5A5A0" />
      <rect x="484" y="332" width="12" height="5" fill="#A5A5A0" />
      <rect x="474" y="324" width="10" height="24" fill="#A5A5A0" />
      <rect x="506" y="344" width="12" height="5" fill="#A5A5A0" />
      <rect x="518" y="336" width="10" height="22" fill="#A5A5A0" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INTERSECTION OBSERVER REVEAL HOOK
   ═══════════════════════════════════════════════════════════════ */
function useReveal(
  refs: React.RefObject<Element | null>[],
  className = 'visible',
  threshold = 0.12,
) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add(className);
        });
      },
      { threshold },
    );
    refs.forEach((r) => {
      if (r.current) observer.observe(r.current);
    });
    return () => observer.disconnect();
  }, []); // refs are stable (created at module level)
}

/* ═══════════════════════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  /* Navbar compact on scroll */
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () =>
      nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Hero mount reveals (staggered) */
  const wordmarkRef = useRef<HTMLHeadingElement>(null);
  const microRef = useRef<HTMLDivElement>(null);
  const envRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t1 = setTimeout(
      () => wordmarkRef.current?.classList.add('visible'),
      60,
    );
    const t2 = setTimeout(
      () => microRef.current?.classList.add('visible'),
      200,
    );
    const t3 = setTimeout(() => envRef.current?.classList.add('visible'), 320);
    const t4 = setTimeout(
      () => taglineRef.current?.classList.add('visible'),
      440,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  /* Scroll-triggered reveals */
  const proof1 = useRef<HTMLDivElement>(null);
  const proof2 = useRef<HTMLDivElement>(null);
  const proof3 = useRef<HTMLDivElement>(null);
  const proof4 = useRef<HTMLDivElement>(null);
  useReveal([proof1, proof2, proof3, proof4]);

  const bwHeadline = useRef<HTMLHeadingElement>(null);
  const bwBody = useRef<HTMLParagraphElement>(null);
  const bwActions = useRef<HTMLDivElement>(null);
  const bwScene = useRef<HTMLDivElement>(null);
  useReveal([bwHeadline, bwBody, bwActions, bwScene]);

  const roleHeader = useRef<HTMLDivElement>(null);
  const role1 = useRef<HTMLDivElement>(null);
  const role2 = useRef<HTMLDivElement>(null);
  const role3 = useRef<HTMLDivElement>(null);
  useReveal([roleHeader, role1, role2, role3]);

  const ctaHeadline = useRef<HTMLHeadingElement>(null);
  const ctaActions = useRef<HTMLDivElement>(null);
  useReveal([ctaHeadline, ctaActions]);

  return (
    <div className="lp-page">
      {/* ╔══════════════════════════════════════════════════════╗
          ║  WHITE WORLD                                         ║
          ╚══════════════════════════════════════════════════════╝ */}
      <div className="lp-white-world">
        {/* ── NAVBAR ── */}
        <nav ref={navRef} className="lp-nav" aria-label="Main navigation">
          <a href="/" className="lp-nav-brand" aria-label="Raptors home">
            Raptors
          </a>

          <ul className="lp-nav-links" role="list">
            <li>
              <a href="/events">Hackathons</a>
            </li>
            <li>
              <a href="/events">Explore</a>
            </li>
            <li>
              <a href="/events/new">Organize</a>
            </li>
            <li>
              <a href="#about">About</a>
            </li>
          </ul>

          <div className="lp-nav-actions">
            <a href="/login" className="lp-nav-signin">
              Sign in
            </a>
            <a href="/register" className="lp-btn-cta" id="lp-get-started-btn">
              Get Started
              <span className="lp-btn-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section className="lp-hero" aria-labelledby="lp-hero-wordmark">
          {/* Stage row: massive wordmark + BUILD/COMPETE/INNOVATE */}
          <div className="lp-hero-stage">
            <div className="lp-composition">
              <h1
                id="lp-hero-wordmark"
                ref={wordmarkRef}
                className="lp-wordmark"
              >
                Raptors
                <span className="sr-only">
                  {' '}
                  — Great ideas deserve a fair starting line.
                </span>
              </h1>
            </div>

            {/* BUILD / COMPETE / INNOVATE microcopy */}
            <div
              ref={microRef}
              className="lp-hero-micro-right"
              aria-label="Platform pillars"
            >
              <span>BUILD</span>
              <span>COMPETE</span>
              <span>INNOVATE</span>
            </div>
          </div>

          {/* Ground environment integrated across the canvas */}
          <div ref={envRef} className="lp-env">
            <HeroEnvironmentSvg />
          </div>
        </section>

        {/* ── TAGLINE + SCROLL CUE ── */}
        <div ref={taglineRef} className="lp-tagline-wrap">
          <p className="lp-tagline" aria-label="Tagline">
            IDEAS DON&apos;T GO EXTINCT.
          </p>
          <div className="lp-scroll-cue" aria-hidden="true">
            <span>SCROLL</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2v10M4 8l4 4 4-4"
                stroke="#8B8B8B"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* ── PROOF STRIP WITH MOCKUP ICONS ── */}
      <div
        className="lp-proof-strip"
        role="list"
        aria-label="Platform capabilities"
      >
        {/* 01 API First */}
        <div
          ref={proof1}
          className="lp-proof-item"
          role="listitem"
          style={{ transitionDelay: '0ms' }}
        >
          <div className="lp-proof-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="lp-proof-content">
            <span className="lp-proof-num">01</span>
            <h3 className="lp-proof-title">API First</h3>
            <p className="lp-proof-desc">
              Complete OpenAPI 3.0 spec. Every UI action has a documented
              endpoint.
            </p>
          </div>
        </div>

        {/* 02 Signed Records */}
        <div
          ref={proof2}
          className="lp-proof-item"
          role="listitem"
          style={{ transitionDelay: '80ms' }}
        >
          <div className="lp-proof-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 8v8M8 12h8"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="lp-proof-content">
            <span className="lp-proof-num">02</span>
            <h3 className="lp-proof-title">Signed Records</h3>
            <p className="lp-proof-desc">
              Ed25519 / HMAC signed judge certificates with instant
              verification.
            </p>
          </div>
        </div>

        {/* 03 Pairwise Judging */}
        <div
          ref={proof3}
          className="lp-proof-item"
          role="listitem"
          style={{ transitionDelay: '160ms' }}
        >
          <div className="lp-proof-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="7" r="4" stroke="#090909" strokeWidth="1.8" />
              <path
                d="M17 11a3 3 0 100-6"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M16 19a3 3 0 003-3v-1a3 3 0 00-3-3"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="lp-proof-content">
            <span className="lp-proof-num">03</span>
            <h3 className="lp-proof-title">Pairwise Judging</h3>
            <p className="lp-proof-desc">
              Bradley–Terry ridge model ranking for fair, calibrated outcomes.
            </p>
          </div>
        </div>

        {/* 04 Portable Archives */}
        <div
          ref={proof4}
          className="lp-proof-item"
          role="listitem"
          style={{ transitionDelay: '240ms' }}
        >
          <div className="lp-proof-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M21 8v13H3V8M1 3h22v5H1V3zM10 12h4"
                stroke="#090909"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="lp-proof-content">
            <span className="lp-proof-num">04</span>
            <h3 className="lp-proof-title">Portable Archives</h3>
            <p className="lp-proof-desc">
              Complete ZIP export and import. Zero data loss, zero vendor
              lock-in.
            </p>
          </div>
        </div>
      </div>

      {/* ── WHITE → BLACK TRANSITION ── */}
      <div className="lp-transition-spacer" aria-hidden="true" />

      {/* ╔══════════════════════════════════════════════════════╗
          ║  BLACK WORLD                                         ║
          ╚══════════════════════════════════════════════════════╝ */}
      <section
        className="lp-black-world"
        aria-labelledby="lp-bw-headline"
        id="about"
      >
        <div className="lp-black-world-left">
          <span className="lp-bw-label">SAME IDEAS.</span>

          <h2 id="lp-bw-headline" ref={bwHeadline} className="lp-bw-headline">
            A BIGGER
            <br />
            TOMORROW.
          </h2>

          <p ref={bwBody} className="lp-bw-body">
            Raptors is a hackathon platform where builders turn bold ideas into
            real-world solutions — with fair judging, transparent results, and
            tools designed for serious events.
          </p>

          <div ref={bwActions} className="lp-bw-actions">
            <a href="/events" className="lp-btn-white" id="lp-explore-btn">
              Explore Hackathons
              <span className="lp-btn-arrow" aria-hidden="true">
                →
              </span>
            </a>
            <a href="/events/new" className="lp-btn-outline" id="lp-host-btn">
              Host a Hackathon
              <span className="lp-btn-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </div>
        </div>

        <div className="lp-black-world-right">
          <div ref={bwScene} className="lp-scene-wrap">
            <DesertSceneSvg />
          </div>
        </div>
      </section>

      {/* ── ROLE ROWS ── */}
      <div className="lp-roles">
        <div ref={roleHeader} className="lp-roles-header">
          <span className="lp-roles-eyebrow">Built for everyone</span>
          <h2 className="lp-roles-title">
            Your role.
            <br />
            Your tools.
          </h2>
        </div>

        <div
          ref={role1}
          className="lp-role-row"
          style={{ transitionDelay: '0ms' }}
        >
          <span className="lp-role-num">01</span>
          <span className="lp-role-name">Organizers</span>
          <p className="lp-role-desc">
            Run the whole event — rubric config, pairwise runs, webhooks, ZIP
            archive export.
          </p>
          <a
            href="/events/new"
            className="lp-role-link"
            id="lp-organizers-link"
          >
            Host an event{' '}
            <span className="lp-role-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>

        <div
          ref={role2}
          className="lp-role-row"
          style={{ transitionDelay: '80ms' }}
        >
          <span className="lp-role-num">02</span>
          <span className="lp-role-name">Judges</span>
          <p className="lp-role-desc">
            Conflict-aware assignments, rubric evaluations, pairwise
            comparisons, signed certificates.
          </p>
          <a href="/events" className="lp-role-link" id="lp-judges-link">
            Judge workspace{' '}
            <span className="lp-role-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>

        <div
          ref={role3}
          className="lp-role-row"
          style={{ transitionDelay: '160ms' }}
        >
          <span className="lp-role-num">03</span>
          <span className="lp-role-name">Builders</span>
          <p className="lp-role-desc">
            Submit projects, form teams, earn participation records, and
            showcase your work publicly.
          </p>
          <a href="/events" className="lp-role-link" id="lp-builders-link">
            Find a hackathon{' '}
            <span className="lp-role-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      </div>

      {/* ── FINAL CTA ── */}
      <div className="lp-final-cta">
        <h2
          ref={ctaHeadline}
          className="lp-final-headline"
          id="lp-final-cta-headline"
        >
          Ready to
          <br />
          build something
          <br />
          that lasts?
        </h2>

        <div ref={ctaActions} className="lp-final-actions">
          <a href="/events" className="lp-btn-white" id="lp-final-explore-btn">
            Explore Hackathons
            <span className="lp-btn-arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a
            href="/events/new"
            className="lp-btn-outline"
            id="lp-final-host-btn"
          >
            Host a Hackathon
            <span className="lp-btn-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer className="lp-footer" aria-label="Site footer">
        <div className="lp-footer-left">
          <span className="lp-footer-brand-name">Raptors</span>
          <span className="lp-footer-byline">by Hackathon Raptors</span>
          <p className="lp-footer-tagline">Ideas don&apos;t go extinct.</p>
          <p role="status" className="raptors-status-indicator">
            <span className="dot online" aria-hidden="true" />
            API online
          </p>
        </div>

        <nav className="lp-footer-links" aria-label="Footer navigation">
          <a href="/events">Explore</a>
          <a href="/events/new">Organize</a>
          <a href="/events">Judging</a>
          <a href="#about">About</a>
          <a href="/api/openapi.json">API Spec</a>
        </nav>
      </footer>

      <div className="lp-footer-copy" role="contentinfo">
        © {new Date().getFullYear()} Hackathon Raptors. Open source · Verified
        records · Built for fair judging.
      </div>
    </div>
  );
}
