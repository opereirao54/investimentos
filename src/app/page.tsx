'use client';

import { ThemeProvider } from 'next-themes';
import { AppShell } from '@/components/AppShell';
import { PhosphorIcons } from '@/lib/PhosphorIcons';

export default function Home() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <PhosphorIcons />
      <AppShell>
        {/* Example content - will be replaced with actual pages */}
        <div
          style={{
            background: 'var(--cor-branco)',
            padding: '24px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--cor-borda)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h2
            style={{
              fontSize: '16px',
              fontWeight: 600,
              fontFamily: 'Syne, sans-serif',
              color: 'var(--cor-texto-principal)',
              marginBottom: '12px',
            }}
          >
            Conteúdo da Página
          </h2>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--cor-texto-mutado)',
              lineHeight: 1.5,
            }}
          >
            Este é um exemplo de conteúdo. Os componentes Sidebar, Header e
            AppShell estão prontos para uso com o design system original
            preservado.
          </p>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
