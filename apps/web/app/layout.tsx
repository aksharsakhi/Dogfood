import { SessionNav } from '../components/session-nav';
import { AuthProvider } from '../lib/auth-context';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Dogfood',
  description: 'A self-hostable home for hackathons.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <header>
            <a href="/">Dogfood</a>
            <span>Hackathons, thoughtfully run.</span>
            <SessionNav />
          </header>
          {children}
          <footer>Open source · Self-hostable · Built for fair judging</footer>
        </AuthProvider>
      </body>
    </html>
  );
}
