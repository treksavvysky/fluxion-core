import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import styles from '@/components/layout.module.css';
import CommandPalette from '@/components/CommandPalette';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

// Every view reads live tracker state from Postgres; never serve a
// build-time prerender. Also keeps `next build` from needing DB access.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Fluxion Core',
  description: 'High-performance project management dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className={styles.appContainer}>
          <Sidebar />
          <main className={styles.mainContent}>
            {children}
          </main>
          <CommandPalette />
        </div>
      </body>
    </html>
  );
}
