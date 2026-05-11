import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Appliquei SaaS - Gestão Financeira Inteligente',
  description: 'Plataforma de gestão financeira pessoal e empresarial com design premium',
  keywords: ['gestão financeira', 'finanças', 'saas', 'appliquei'],
  authors: [{ name: 'Appliquei Team' }],
  openGraph: {
    title: 'Appliquei SaaS',
    description: 'Gestão Financeira Inteligente',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
