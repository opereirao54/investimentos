'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { logout, getCurrentUser } from '@/lib/firebase/auth';
import { getUserData, UserData } from '@/lib/firebase/users';

interface AppShellProps {
  children: React.ReactNode;
  currentPage: string;
}

/**
 * AppShell - Layout principal com Sidebar Dark Premium
 * Replica o design da sidebar do código legado
 */
export default function AppShell({ children, currentPage }: AppShellProps) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Carregar dados do utilizador
    const loadUser = async () => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        const userData = await getUserData(currentUser.uid);
        setUser(userData);
      }
      setLoading(false);
    };

    loadUser();
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'ph-squares-four' },
    { id: 'controle', label: 'Controle Financeiro', icon: 'ph-wallet' },
    { id: 'patrimonio', label: 'Patrimônio', icon: 'ph-trend-up' },
    { id: 'cartoes', label: 'Cartões de Crédito', icon: 'ph-credit-card' },
    { id: 'sonhos', label: 'Sonhos & Metas', icon: 'ph-target' },
    { id: 'applicash', label: 'Applicash $', icon: 'ph-currency-dollar', accent: true },
    { id: 'relatorios', label: 'Relatórios', icon: 'ph-chart-bar' },
    { id: 'configuracoes', label: 'Configurações', icon: 'ph-gear' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-main-fundo">
        <div className="text-cor-texto-mutado">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-main-fundo overflow-hidden">
      {/* Sidebar Dark Premium */}
      <aside
        className={`bg-sb-bg border-r border-sb-border transition-all duration-[0.28s] cubic-bezier(0.4,0,0.2,1) ${
          sidebarCollapsed ? 'w-[64px]' : 'w-[240px]'
        }`}
      >
        {/* Logo Area */}
        <div className="h-[70px] px-[16px] border-b border-sb-border flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center overflow-hidden">
            <img
              src="/applikei_logo_white.jpg"
              alt="Appliquei"
              className="h-[38px] w-auto object-contain mix-blend-screen opacity-[0.88] hover:opacity-100 transition-opacity"
            />
            {!sidebarCollapsed && (
              <span className="font-syne text-[15px] font-bold text-sb-accent ml-2 whitespace-nowrap">
                Appliquei
              </span>
            )}
          </Link>
          
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="text-sb-text hover:text-sb-textActive hover:bg-sb-hover p-[5px] rounded-[7px] transition-all"
          >
            <i className={`ph ${sidebarCollapsed ? 'ph-list' : 'ph-caret-left'} text-[16px]`}></i>
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-[10px] flex-1 overflow-y-auto">
          {/* Grupo Principal */}
          <div className="mb-4">
            {!sidebarCollapsed && (
              <span className="text-[9px] font-bold text-sb-groupLabel uppercase tracking-[1.2px] block px-[10px] mb-2">
                Principal
              </span>
            )}
            
            {menuItems.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                href={`/${item.id === 'dashboard' ? 'dashboard' : item.id}`}
                className={`flex items-center gap-[10px] px-[10px] py-[9px] mb-[2px] rounded-[9px] text-[13px] font-medium transition-all w-full ${
                  currentPage === item.id
                    ? 'bg-sb-accent-dim text-sb-accent font-semibold border border-sb-accent-border'
                    : 'text-sb-text hover:bg-sb-hover hover:text-sb-textActive'
                }`}
              >
                <i className={`ph ${item.icon} text-[17px]`}></i>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            ))}
          </div>

          {/* Grupo Applicash */}
          <div className="mb-4">
            {!sidebarCollapsed && (
              <span className="text-[9px] font-bold text-sb-groupLabel uppercase tracking-[1.2px] block px-[10px] mb-2">
                Monetização
              </span>
            )}
            
            <Link
              href="/applicash"
              className={`flex items-center gap-[10px] px-[10px] py-[9px] mb-[2px] rounded-[9px] text-[13px] font-medium transition-all w-full ${
                currentPage === 'applicash'
                  ? 'bg-sb-accent-dim text-sb-accent font-semibold border border-sb-accent-border'
                  : 'text-sb-text hover:bg-sb-hover hover:text-sb-textActive'
              }`}
            >
              <i className="ph ph-currency-dollar text-[17px]"></i>
              {!sidebarCollapsed && (
                <span className="text-sb-accent">Applicash $</span>
              )}
            </Link>
          </div>

          {/* Grupo Settings */}
          <div>
            {!sidebarCollapsed && (
              <span className="text-[9px] font-bold text-sb-groupLabel uppercase tracking-[1.2px] block px-[10px] mb-2">
                Sistema
              </span>
            )}
            
            {menuItems.slice(6).map((item) => (
              <Link
                key={item.id}
                href={`/${item.id}`}
                className={`flex items-center gap-[10px] px-[10px] py-[9px] mb-[2px] rounded-[9px] text-[13px] font-medium transition-all w-full ${
                  currentPage === item.id
                    ? 'bg-sb-accent-dim text-sb-accent font-semibold border border-sb-accent-border'
                    : 'text-sb-text hover:bg-sb-hover hover:text-sb-textActive'
                }`}
              >
                <i className={`ph ${item.icon} text-[17px]`}></i>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            ))}
          </div>
        </nav>

        {/* Footer da Sidebar */}
        <div className="p-[14px] border-t border-sb-border bg-sb-footerBg">
          {user && !sidebarCollapsed && (
            <div className="mb-3">
              <p className="text-[12px] text-sb-text truncate">{user.displayName || user.email}</p>
              <p className="text-[10px] text-sb-groupLabel capitalize">
                Plano: <span className="text-sb-accent">{user.plano}</span>
              </p>
            </div>
          )}
          
          <div className="flex items-center gap-[7px] text-[11px] text-sb-groupLabel">
            <span className="w-[6px] h-[6px] rounded-full bg-sb-accent flex-shrink-0 animate-pulse"></span>
            {!sidebarCollapsed && <span>Online</span>}
          </div>
          
          {!sidebarCollapsed && (
            <button
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-[8px] px-[10px] py-[8px] text-[12px] text-sb-text hover:text-sb-textActive hover:bg-sb-hover rounded-[9px] transition-all"
            >
              <i className="ph ph-sign-out text-[16px]"></i>
              <span>Sair</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-[30px]">
        {children}
      </main>
    </div>
  );
}
