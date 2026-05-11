'use client';

import { useState } from 'react';
import Image from 'next/image';

interface MenuItem {
  icon: string;
  label: string;
  tooltip: string;
  group: string;
  active?: boolean;
}

const menuItems: MenuItem[] = [
  // Portfólio
  { icon: 'ph-bank', label: 'Meu patrimônio', tooltip: 'Meu patrimônio', group: 'Portfólio' },
  { icon: 'ph-receipt', label: 'Controle financeiro', tooltip: 'Controle financeiro', group: 'Portfólio' },
  { icon: 'ph-wallet', label: 'Meus investimentos', tooltip: 'Meus investimentos', group: 'Portfólio', active: true },
  { icon: 'ph-chart-pie-slice', label: 'Carteira recomendada', tooltip: 'Carteira recomendada', group: 'Portfólio' },
  { icon: 'ph-file-text', label: 'Relatório mensal', tooltip: 'Relatório mensal', group: 'Portfólio' },
  // Ferramentas
  { icon: 'ph-calculator', label: 'Simule sua liberdade', tooltip: 'Simule sua liberdade', group: 'Ferramentas' },
  { icon: 'ph-star', label: 'Meus sonhos', tooltip: 'Meus sonhos', group: 'Ferramentas' },
  { icon: 'ph-graduation-cap', label: 'Jornada Financeira', tooltip: 'Jornada Financeira', group: 'Ferramentas' },
  { icon: 'ph-newspaper', label: 'Info Mercado', tooltip: 'Info Mercado', group: 'Ferramentas' },
  // Applicash $
  { icon: 'ph-currency-dollar', label: 'Applicash $', tooltip: 'Applicash $', group: 'Applicash $' },
  // Suporte
  { icon: 'ph-question', label: 'Dúvidas & Sugestões', tooltip: 'Dúvidas & Sugestões', group: 'Suporte' },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const [activeItem, setActiveItem] = useState('Meus investimentos');

  const groupedItems = menuItems.reduce((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = [];
    }
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      style={{
        width: collapsed ? '64px' : '240px',
        background: 'linear-gradient(180deg, var(--sb-bg) 0%, #0d1914 100%)',
        borderRight: '1px solid var(--sb-border)',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        zIndex: 10,
        transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: '2px 0 20px rgba(0,0,0,0.18)',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}
    >
      {/* Logo Area */}
      <div
        className="logo-area"
        style={{
          padding: collapsed ? '12px 0' : '14px 16px 12px',
          borderBottom: '1px solid var(--sb-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        <a
          href="#"
          className="logo-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
            overflow: 'hidden',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : undefined,
          }}
        >
          <Image
            src="/appliquei_logo_white.jpg"
            alt="Appliquei"
            width={collapsed ? 38 : 170}
            height={collapsed ? 38 : 44}
            className="logo-img"
            style={{
              width: collapsed ? '38px' : '170px',
              height: 'auto',
              objectFit: 'contain',
              objectPosition: collapsed ? 'center' : 'left center',
              transition: 'all 0.2s ease',
              mixBlendMode: 'screen',
              opacity: 0.88,
              borderRadius: collapsed ? '10px' : undefined,
            }}
          />
        </a>
        {!collapsed && (
          <button
            className="sidebar-toggle"
            onClick={onToggle}
            title="Recolher menu"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--sb-text)',
              padding: '5px 7px',
              borderRadius: '7px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              fontSize: '16px',
            }}
          >
            <i className="ph ph-sidebar-simple" id="iconToggle"></i>
          </button>
        )}
      </div>

      {/* Navigation Area */}
      <div
        className="nav-area"
        style={{
          padding: collapsed ? '8px 6px' : '10px 10px',
          flex: 1,
        }}
      >
        {Object.entries(groupedItems).map(([group, items]) => (
          <div
            key={group}
            className="nav-group"
            style={{ marginBottom: collapsed ? '6px' : '16px' }}
          >
            {!collapsed && (
              <span
                className="nav-group-label"
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                  color: 'var(--sb-group-label)',
                  textTransform: 'uppercase',
                  padding: '0 10px',
                  marginBottom: '6px',
                  display: 'block',
                }}
              >
                {group}
              </span>
            )}
            {items.map((item) => (
              <button
                key={item.label}
                className={`menu-btn ${item.active || activeItem === item.label ? 'ativo' : ''}`}
                data-tooltip={item.tooltip}
                onClick={() => setActiveItem(item.label)}
                style={{
                  background: item.active || activeItem === item.label ? 'var(--sb-accent-dim)' : 'transparent',
                  color: item.active || activeItem === item.label ? 'var(--sb-accent)' : 'var(--sb-text)',
                  fontWeight: item.active || activeItem === item.label ? 600 : 500,
                  border: item.active || activeItem === item.label ? '1px solid var(--sb-accent-border)' : 'none',
                  padding: collapsed ? '11px' : '9px 10px',
                  marginBottom: '2px',
                  textAlign: 'left',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: '0.2s ease',
                  borderRadius: '9px',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontFamily: 'Figtree, sans-serif',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  position: 'relative',
                  overflow: collapsed ? 'visible' : 'hidden',
                }}
              >
                <i
                  className={`ph ${item.icon}`}
                  style={{ fontSize: collapsed ? '20px' : '17px', flexShrink: 0 }}
                ></i>
                {!collapsed && <span className="menu-btn-label">{item.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Sidebar Footer */}
      <div
        className="sidebar-footer"
        style={{
          padding: collapsed ? '12px 6px' : '14px 16px',
          borderTop: '1px solid var(--sb-border)',
          background: 'var(--sb-footer-bg)',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <div
          className="ultimo-salvo"
          id="ultimoSalvoIndicador"
          title="Último salvamento"
          style={{
            fontSize: '11px',
            color: 'var(--sb-group-label)',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
          }}
        >
          <div
            className="status-dot-sidebar"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--sb-accent)',
              flexShrink: 0,
              boxShadow: '0 0 6px rgba(16,185,129,0.6)',
              animation: 'pulse-dot 2.5s infinite',
            }}
          ></div>
          {!collapsed && <span id="ultimoSalvoTxt">Pronto</span>}
        </div>
      </div>

      {/* Custom styles for scrollbar and animations */}
      <style jsx>{`
        .sidebar::-webkit-scrollbar {
          width: 4px;
        }
        .sidebar::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .menu-btn:hover {
          background: var(--sb-hover);
          color: var(--sb-text-active);
        }
        .menu-btn.ativo i {
          color: var(--sb-accent);
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </aside>
  );
}
