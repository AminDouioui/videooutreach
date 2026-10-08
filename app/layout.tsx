import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video-Outreach',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
