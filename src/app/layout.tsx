import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Appliquei v13.0 - Gestão Financeira Inteligente',
  description: 'Sistema de gestão financeira inteligente',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
