'use client';

import React from 'react';

function getHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * ProceduralScene
 * Deterministic monochrome SVG banner for event and project cards.
 * Generates one of 4 subtle desert/mountain/moon scenes based on seed.
 */
export function ProceduralScene({
  seed,
  height = 130,
}: {
  seed: string;
  height?: number;
}) {
  const hash = getHash(seed || 'raptors');
  const variant = hash % 4;

  if (variant === 0) {
    /* ── VARIANT 0: OFF-WHITE HORIZON + TALL CACTUS + CLOUDS ── */
    return (
      <div
        className="procedural-scene-wrap"
        style={{ height, width: '100%', overflow: 'hidden' }}
      >
        <svg
          viewBox="0 0 400 130"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', display: 'block' }}
          aria-hidden="true"
        >
          <rect width="400" height="130" fill="#F7F7F4" />

          {/* Sun ring outline */}
          <circle
            cx="320"
            cy="38"
            r="18"
            stroke="#DADAD6"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {/* Drifting pixel cloud */}
          <rect x="180" y="24" width="16" height="5" fill="#E5E5E1" />
          <rect x="176" y="29" width="24" height="5" fill="#E5E5E1" />
          <rect x="180" y="34" width="16" height="3" fill="#E5E5E1" />

          {/* Ground baseline */}
          <line
            x1="0"
            y1="96"
            x2="400"
            y2="96"
            stroke="#B8B8B3"
            strokeWidth="1.5"
          />

          {/* Stepped terrain stones */}
          <rect x="40" y="93" width="8" height="3" fill="#CFCFCB" />
          <rect x="120" y="94" width="14" height="2" fill="#DADAD6" />
          <rect x="230" y="93" width="10" height="3" fill="#CFCFCB" />
          <rect x="340" y="94" width="12" height="2" fill="#DADAD6" />

          {/* Left tall cactus silhouette */}
          <rect x="68" y="52" width="6" height="44" fill="#383838" />
          <rect x="60" y="66" width="8" height="3" fill="#383838" />
          <rect x="55" y="61" width="6" height="14" fill="#383838" />
          <rect x="74" y="72" width="7" height="3" fill="#383838" />
          <rect x="80" y="67" width="5" height="12" fill="#383838" />

          {/* Right small cactus */}
          <rect x="280" y="74" width="5" height="22" fill="#383838" />
          <rect x="274" y="81" width="6" height="3" fill="#383838" />
          <rect x="270" y="78" width="5" height="9" fill="#383838" />
        </svg>
      </div>
    );
  }

  if (variant === 1) {
    /* ── VARIANT 1: MIDNIGHT MOUNTAIN PEAKS + SOLID MOON ── */
    return (
      <div
        className="procedural-scene-wrap"
        style={{ height, width: '100%', overflow: 'hidden' }}
      >
        <svg
          viewBox="0 0 400 130"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', display: 'block' }}
          aria-hidden="true"
        >
          <rect width="400" height="130" fill="#121212" />

          {/* Orbit rings */}
          <circle cx="280" cy="52" r="42" stroke="#222222" strokeWidth="1" />
          <circle cx="280" cy="52" r="32" stroke="#282828" strokeWidth="1" />

          {/* Solid moon disk */}
          <circle cx="280" cy="52" r="22" fill="#F7F7F4" />

          {/* Stars */}
          <rect x="60" y="24" width="2" height="2" fill="#383838" />
          <rect x="140" y="40" width="2" height="2" fill="#2d2d2d" />
          <rect x="360" y="28" width="2" height="2" fill="#383838" />

          {/* Distant mountain */}
          <polygon points="40,110 120,55 200,110" fill="#252525" />
          <polygon points="160,110 240,65 320,110" fill="#1f1f1f" />
          <polygon points="260,110 330,70 400,110" fill="#282828" />

          {/* Foreground mountain ridge */}
          <path
            d="M0 110 L50 82 L110 110 L180 75 L250 110 L310 88 L370 110 L400 95 L400 130 L0 130 Z"
            fill="#161616"
          />
          <line
            x1="0"
            y1="110"
            x2="400"
            y2="110"
            stroke="#2c2c2c"
            strokeWidth="1.5"
          />

          {/* Foreground cactus */}
          <rect x="90" y="88" width="5" height="22" fill="#7a7a75" />
          <rect x="85" y="95" width="5" height="3" fill="#7a7a75" />
          <rect x="81" y="92" width="5" height="8" fill="#7a7a75" />
        </svg>
      </div>
    );
  }

  if (variant === 2) {
    /* ── VARIANT 2: TWIN SAGUARO + STEPPED TERRAIN + CLOUDS ── */
    return (
      <div
        className="procedural-scene-wrap"
        style={{ height, width: '100%', overflow: 'hidden' }}
      >
        <svg
          viewBox="0 0 400 130"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', display: 'block' }}
          aria-hidden="true"
        >
          <rect width="400" height="130" fill="#F7F7F4" />

          {/* Pixel cloud left */}
          <rect x="50" y="26" width="14" height="4" fill="#E5E5E1" />
          <rect x="46" y="30" width="22" height="4" fill="#E5E5E1" />
          <rect x="50" y="34" width="14" height="3" fill="#E5E5E1" />

          {/* Pixel cloud right */}
          <rect x="250" y="20" width="20" height="5" fill="#DADAD6" />
          <rect x="244" y="25" width="30" height="5" fill="#DADAD6" />
          <rect x="248" y="30" width="22" height="4" fill="#DADAD6" />

          {/* Ground baseline */}
          <line
            x1="0"
            y1="96"
            x2="400"
            y2="96"
            stroke="#B8B8B3"
            strokeWidth="1.5"
          />

          {/* Stepped terrain stones */}
          <rect x="24" y="93" width="10" height="3" fill="#CFCFCB" />
          <rect x="150" y="93" width="8" height="3" fill="#BFC0BC" />
          <rect x="270" y="94" width="16" height="2" fill="#DADAD6" />
          <rect x="360" y="93" width="12" height="3" fill="#CFCFCB" />

          {/* Twin cacti standing together */}
          <rect x="195" y="58" width="6" height="38" fill="#383838" />
          <rect x="188" y="70" width="7" height="3" fill="#383838" />
          <rect x="184" y="65" width="5" height="12" fill="#383838" />

          <rect x="215" y="68" width="5" height="28" fill="#383838" />
          <rect x="220" y="77" width="6" height="3" fill="#383838" />
          <rect x="225" y="73" width="5" height="10" fill="#383838" />
        </svg>
      </div>
    );
  }

  /* ── VARIANT 3: CHARCOAL RIDGE & ECLIPSE MOON ── */
  return (
    <div
      className="procedural-scene-wrap"
      style={{ height, width: '100%', overflow: 'hidden' }}
    >
      <svg
        viewBox="0 0 400 130"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
        aria-hidden="true"
      >
        <rect width="400" height="130" fill="#181818" />

        {/* Big moon with ring */}
        <circle cx="110" cy="48" r="32" stroke="#2a2a2a" strokeWidth="1" />
        <circle cx="110" cy="48" r="18" fill="#E5E5E1" />

        {/* Star speckles */}
        <rect x="210" y="30" width="2" height="2" fill="#383838" />
        <rect x="310" y="45" width="2" height="2" fill="#2d2d2d" />
        <rect x="370" y="25" width="2" height="2" fill="#383838" />

        {/* Mountain silhouette */}
        <polygon points="120,110 210,60 300,110" fill="#222222" />
        <polygon points="240,110 320,68 400,110" fill="#202020" />
        <path
          d="M0 110 L60 90 L140 110 L230 85 L320 110 L400 98 L400 130 L0 130 Z"
          fill="#111111"
        />
        <line
          x1="0"
          y1="110"
          x2="400"
          y2="110"
          stroke="#262626"
          strokeWidth="1.5"
        />

        {/* Tall cactus on the right */}
        <rect x="330" y="70" width="6" height="40" fill="#888880" />
        <rect x="322" y="82" width="8" height="3" fill="#888880" />
        <rect x="317" y="77" width="6" height="13" fill="#888880" />
        <rect x="336" y="87" width="8" height="3" fill="#888880" />
        <rect x="343" y="83" width="5" height="11" fill="#888880" />
      </svg>
    </div>
  );
}

/**
 * EventHeroScene
 * Panoramic procedural header for Hackathon detail page.
 */
export function EventHeroScene({ seed }: { seed: string }) {
  const hash = getHash(seed || 'raptors-hero');
  const showDark = hash % 2 === 1;

  if (showDark) {
    return (
      <div
        className="event-hero-scene-wrap"
        style={{ height: 200, width: '100%', overflow: 'hidden' }}
      >
        <svg
          viewBox="0 0 1200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', display: 'block' }}
          aria-hidden="true"
        >
          <rect width="1200" height="200" fill="#090909" />
          {/* Orbit rings & Moon */}
          <circle cx="850" cy="80" r="75" stroke="#1f1f1f" strokeWidth="1" />
          <circle cx="850" cy="80" r="55" stroke="#262626" strokeWidth="1" />
          <circle cx="850" cy="80" r="38" fill="#F7F7F4" />

          {/* Stars */}
          <rect x="120" y="40" width="3" height="3" fill="#2d2d2d" />
          <rect x="340" y="60" width="2" height="2" fill="#242424" />
          <rect x="520" y="30" width="3" height="3" fill="#2d2d2d" />
          <rect x="1050" y="50" width="2" height="2" fill="#282828" />

          {/* Mountains */}
          <polygon points="300,165 480,95 660,165" fill="#222222" />
          <polygon points="560,165 720,80 880,165" fill="#1c1c1c" />
          <polygon points="780,165 920,90 1060,165" fill="#242424" />
          <path
            d="M0 165 L180 125 L380 165 L560 115 L760 165 L960 125 L1140 165 L1200 150 L1200 200 L0 200 Z"
            fill="#121212"
          />
          <line
            x1="0"
            y1="165"
            x2="1200"
            y2="165"
            stroke="#262626"
            strokeWidth="1.5"
          />

          {/* Cacti */}
          <rect x="220" y="125" width="8" height="40" fill="#7a7a75" />
          <rect x="212" y="140" width="9" height="4" fill="#7a7a75" />
          <rect x="206" y="134" width="7" height="15" fill="#7a7a75" />
          <rect x="990" y="115" width="9" height="50" fill="#A5A5A0" />
          <rect x="980" y="135" width="11" height="4" fill="#A5A5A0" />
          <rect x="972" y="128" width="9" height="18" fill="#A5A5A0" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="event-hero-scene-wrap"
      style={{ height: 200, width: '100%', overflow: 'hidden' }}
    >
      <svg
        viewBox="0 0 1200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
        aria-hidden="true"
      >
        <rect width="1200" height="200" fill="#F7F7F4" />
        {/* Pixel clouds */}
        <rect x="180" y="32" width="24" height="6" fill="#DADAD6" />
        <rect x="174" y="38" width="36" height="6" fill="#DADAD6" />
        <rect x="180" y="44" width="24" height="4" fill="#DADAD6" />

        <rect x="820" y="24" width="20" height="5" fill="#E5E5E1" />
        <rect x="814" y="29" width="32" height="5" fill="#E5E5E1" />
        <rect x="820" y="34" width="20" height="4" fill="#E5E5E1" />

        {/* Sun ring */}
        <circle
          cx="1020"
          cy="60"
          r="26"
          stroke="#DADAD6"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        {/* Horizon line */}
        <line
          x1="0"
          y1="165"
          x2="1200"
          y2="165"
          stroke="#B8B8B3"
          strokeWidth="1.5"
        />

        {/* Terrain rocks */}
        <rect x="80" y="162" width="12" height="3" fill="#CFCFCB" />
        <rect x="360" y="162" width="14" height="3" fill="#BFC0BC" />
        <rect x="640" y="163" width="18" height="2" fill="#DADAD6" />
        <rect x="920" y="162" width="12" height="3" fill="#CFCFCB" />

        {/* Cacti */}
        <rect x="140" y="115" width="8" height="50" fill="#383838" />
        <rect x="130" y="134" width="10" height="4" fill="#383838" />
        <rect x="122" y="128" width="8" height="18" fill="#383838" />
        <rect x="148" y="142" width="10" height="4" fill="#383838" />
        <rect x="157" y="136" width="8" height="16" fill="#383838" />

        <rect x="740" y="128" width="7" height="37" fill="#383838" />
        <rect x="733" y="141" width="8" height="4" fill="#383838" />
        <rect x="727" y="137" width="6" height="12" fill="#383838" />
      </svg>
    </div>
  );
}
