'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface AppShellProps {
  children?: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [valuesHidden, setValuesHidden] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const toggleValuesHidden = () => {
    setValuesHidden(!valuesHidden);
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: 'var(--cor-fundo)',
        color: 'var(--cor-texto-principal)',
        overflow: 'hidden',
        transition: 'background 0.3s, color 0.3s',
      }}
    >
      {/* Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      {/* Main Content Area */}
      <main
        className="main-content"
        style={{
          flex: 1,
          padding: '30px 40px',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Header with theme toggle */}
        <Header
          title="Visão geral do patrimônio"
          subtitle="Acompanhe a evolução do seu capital, cotações em tempo real e rentabilidade."
          showWarningBadge={false}
          valuesHidden={valuesHidden}
          onToggleValues={toggleValuesHidden}
        />

        {/* Page Content */}
        {children}
      </main>

      {/* Global styles for CSS variables and animations */}
      <style jsx global>{`
        :root {
          /* Sidebar dark tokens (sempre escura) */
          --sb-bg: #0b1410;
          --sb-bg2: #111c17;
          --sb-border: #1c2e24;
          --sb-text: #8aab94;
          --sb-text-active: #f0faf4;
          --sb-accent: #10b981;
          --sb-accent-dim: rgba(16, 185, 129, 0.10);
          --sb-accent-border: rgba(16, 185, 129, 0.22);
          --sb-hover: rgba(255, 255, 255, 0.04);
          --sb-group-label: #3d6050;
          --sb-footer-bg: #0d1813;

          /* Main area light mode */
          --cor-fundo: #f2f5f2;
          --cor-branco: #ffffff;
          --cor-superficie: #edf0ed;
          --cor-texto-principal: #101e13;
          --cor-texto-secundario: #3b5440;
          --cor-texto-mutado: #7a9480;
          --cor-borda: #dfe7e0;
          --cor-borda2: #c4d2c7;

          --cor-primaria: #059669;
          --cor-primaria-hover: #047857;
          --cor-info: #2563eb;
          --cor-patrimonio: #7c3aed;
          --cor-erro: #dc2626;
          --cor-cartao: #d97706;

          --cor-bg-primaria: #ecfdf5;
          --cor-bg-info: #eff6ff;
          --cor-bg-erro: #fef2f2;
          --cor-borda-primaria: #6ee7b7;
          --cor-borda-info: #bfdbfe;
          --cor-borda-erro: #fecaca;
          --cor-txt-primaria: #065f46;
          --cor-txt-info: #1e40af;
          --cor-txt-erro: #991b1b;
          --cor-bg-amber: #fffbeb;
          --cor-borda-amber: #fde68a;
          --cor-txt-amber: #92400e;

          --radius: 14px;
          --radius-sm: 9px;
          --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.04),
            0 6px 20px rgba(0, 0, 0, 0.05);
          --shadow-hover: 0 2px 6px rgba(0, 0, 0, 0.06),
            0 14px 32px rgba(0, 0, 0, 0.08);
          --shadow-suave: 0 1px 3px rgba(0, 0, 0, 0.04);
          --shadow-media: 0 4px 16px rgba(0, 0, 0, 0.06);
          --transicao: 0.2s ease;
        }

        .dark {
          --cor-fundo: #0e1611;
          --cor-branco: #141f16;
          --cor-superficie: #1a2b1d;
          --cor-texto-principal: #e4f0e7;
          --cor-texto-secundario: #739e7a;
          --cor-texto-mutado: #466b4d;
          --cor-borda: #213029;
          --cor-borda2: #2c4435;
          --cor-primaria: #34d399;
          --cor-primaria-hover: #6ee7b7;
          --cor-info: #60a5fa;
          --cor-patrimonio: #a78bfa;
          --cor-erro: #f87171;
          --cor-cartao: #fbbf24;
          --cor-bg-primaria: #052e1a;
          --cor-bg-info: #0c1a3a;
          --cor-bg-erro: #2d0a0a;
          --cor-borda-primaria: #065f3a;
          --cor-borda-info: #1e3a5f;
          --cor-borda-erro: #7f1d1d;
          --cor-txt-primaria: #6ee7b7;
          --cor-txt-info: #93c5fd;
          --cor-txt-erro: #fca5a5;
          --cor-bg-amber: #2d1a00;
          --cor-borda-amber: #854f0b;
          --cor-txt-amber: #fcd34d;
          --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.15),
            0 6px 20px rgba(0, 0, 0, 0.2);
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          font-family: 'Figtree', sans-serif;
        }

        body {
          background-color: var(--cor-fundo);
          color: var(--cor-texto-principal);
          transition: background 0.3s, color 0.3s;
        }

        /* Value masking when hidden */
        body.valores-ocultos .valor-mascarado,
        body.valores-ocultos .valor {
          filter: blur(9px) !important;
          user-select: none;
          transition: filter 0.25s ease;
        }

        @keyframes pulse-dot {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
