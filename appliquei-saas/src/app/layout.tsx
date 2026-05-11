import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Appliquei SaaS - Gestão Financeira Inteligente',
  description: 'Plataforma de gestão financeira pessoal com sistema de indicações Applicash',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>{children}</body>
    </html>
  );
}
