'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showBackupButton?: boolean;
  showAddOperationButton?: boolean;
  showEyeToggle?: boolean;
  valuesHidden?: boolean;
  onToggleValues?: () => void;
  showWarningBadge?: boolean;
}

export function Header({
  title = 'Visão geral do patrimônio',
  subtitle = 'Acompanhe a evolução do seu capital, cotações em tempo real e rentabilidade.',
  showBackupButton = true,
  showAddOperationButton = true,
  showEyeToggle = true,
  valuesHidden = false,
  onToggleValues,
  showWarningBadge = false,
}: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  if (!mounted) {
    return null;
  }

  return (
    <div
      className="page-header"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '24px',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      {/* Left side: Title and subtitle */}
      <div className="page-header-left">
        <h1
          style={{
            fontSize: '21px',
            fontWeight: 700,
            fontFamily: 'Syne, sans-serif',
            color: 'var(--cor-texto-principal)',
            marginBottom: '5px',
            letterSpacing: '-0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
          }}
        >
          {title}
        </h1>
        <p
          className="subtitulo"
          style={{
            color: 'var(--cor-texto-mutado)',
            fontSize: '13px',
            fontWeight: 400,
            marginBottom: 0,
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Right side: Actions */}
      <div
        className="page-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Warning Badge */}
        {showWarningBadge && (
          <span
            id="badgePrecosEstimados"
            title="Não foi possível buscar cotações do Yahoo Finance. Preços exibidos são estimativas."
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '99px',
              fontSize: '11.5px',
              fontWeight: 600,
              background: 'var(--cor-bg-amber)',
              color: 'var(--cor-txt-amber)',
              border: '1px solid var(--cor-borda-amber)',
            }}
          >
            <i className="ph-fill ph-warning"></i>
            Preços estimados
          </span>
        )}

        {/* Backup Button */}
        {showBackupButton && (
          <button
            className="btn-secundario"
            onClick={() => console.log('Exportar dados')}
            title="Backup JSON dos seus dados (ficam só no navegador)"
            style={{
              background: 'var(--cor-superficie)',
              border: '1px solid var(--cor-borda)',
              color: 'var(--cor-texto-secundario)',
              padding: '8px 14px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: '0.2s ease',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: 'Figtree, sans-serif',
            }}
          >
            <i className="ph ph-download-simple"></i>
            Backup
          </button>
        )}

        {/* Add Operation Button */}
        {showAddOperationButton && (
          <button
            className="btn-acao"
            onClick={() => console.log('Registrar operação')}
            style={{
              backgroundColor: 'var(--cor-primaria)',
              color: 'white',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: '0.2s ease',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: 'Figtree, sans-serif',
            }}
          >
            <i className="ph-bold ph-plus"></i>
            Registrar operação
          </button>
        )}

        {/* Eye Toggle Button */}
        {showEyeToggle && (
          <button
            className={`btn-eye ${valuesHidden ? 'ativo' : ''}`}
            onClick={onToggleValues}
            title={valuesHidden ? 'Mostrar valores' : 'Ocultar valores'}
            style={{
              background: valuesHidden
                ? 'var(--cor-bg-primaria)'
                : 'var(--cor-superficie)',
              border: valuesHidden
                ? '1px solid var(--cor-borda-primaria)'
                : '1px solid var(--cor-borda)',
              color: valuesHidden ? 'var(--cor-primaria)' : 'var(--cor-texto-secundario)',
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: '0.2s ease',
              flexShrink: 0,
            }}
          >
            <i
              className={`ph ${valuesHidden ? 'ph-eye-slash' : 'ph-eye'}`}
              style={{ fontSize: '16px' }}
            ></i>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          className="btn-theme"
          onClick={toggleTheme}
          title="Alternar tema"
          style={{
            background: 'var(--cor-superficie)',
            border: '1px solid var(--cor-borda)',
            color: 'var(--cor-texto-secundario)',
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: '0.2s ease',
            flexShrink: 0,
          }}
        >
          <i
            className={`ph ${theme === 'dark' ? 'ph-moon' : 'ph-sun'}`}
            id="iconTheme"
            style={{ fontSize: '16px' }}
          ></i>
        </button>
      </div>

      {/* Hover styles */}
      <style jsx>{`
        .btn-secundario:hover {
          border-color: var(--cor-borda2);
          color: var(--cor-primaria);
          background: var(--cor-bg-primaria);
        }
        .btn-acao:hover {
          background-color: var(--cor-primaria-hover);
        }
        .btn-eye:hover {
          border-color: var(--cor-borda2);
          color: var(--cor-primaria);
          background: var(--cor-bg-primaria);
        }
        .btn-theme:hover {
          border-color: var(--cor-borda2);
          color: var(--cor-primaria);
          background: var(--cor-bg-primaria);
        }
      `}</style>
    </div>
  );
}
