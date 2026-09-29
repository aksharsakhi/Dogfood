import { AppShell } from '../components/app-shell';
import { AuthProvider } from '../lib/auth-context';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: "Raptors — Ideas don't go extinct",
  description:
    'A hackathon platform built by Hackathon Raptors for fair judging, verifiable records, serious event operations, and projects worth showcasing.',
  keywords: ['hackathon', 'judging', 'pairwise', 'builder', 'Raptors'],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
