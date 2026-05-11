'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/firebase/auth';
import AppShell from '@/components/AppShell';

/**
 * Página Dashboard
 * Primeira página após login
 */
export default function DashboardPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Verificar autenticação
    const user = getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }
    setIsAuthenticated(true);
  }, [router]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-main-fundo">
        <div className="text-cor-texto-mutado">Carregando...</div>
      </div>
    );
  }

  return (
    <AppShell currentPage="dashboard">
      <div className="max-w-[1200px] mx-auto">
        {/* Header da Página */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-syne text-[21px] font-bold text-cor-texto-principal flex items-center gap-2">
              <i className="ph ph-squares-four"></i>
              Dashboard
            </h1>
            <p className="text-cor-texto-mutado text-[13px] mt-1">
              Visão geral da sua saúde financeira
            </p>
          </div>
        </div>

        {/* Cards de Resumo */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[14px] mb-5">
          {/* Card 1 */}
          <div className="bg-cor-branco p-[20px] rounded-[14px] border border-cor-borda shadow-card relative overflow-hidden hover:shadow-hover transition-all">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-primaria to-transparent opacity-50"></div>
            <h3 className="text-[10.5px] text-cor-texto-mutado font-semibold uppercase tracking-wide mb-2.5 flex items-center gap-1">
              <i className="ph ph-wallet text-[14px]"></i>
              Saldo Atual
            </h3>
            <p className="text-[24px] font-semibold text-cor-texto-principal font-mono tracking-tight">
              R$ 0,00
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-cor-branco p-[20px] rounded-[14px] border border-cor-borda shadow-card relative overflow-hidden hover:shadow-hover transition-all">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-info to-transparent opacity-50"></div>
            <h3 className="text-[10.5px] text-cor-texto-mutado font-semibold uppercase tracking-wide mb-2.5 flex items-center gap-1">
              <i className="ph ph-arrow-down-left text-[14px]"></i>
              Receitas (Mês)
            </h3>
            <p className="text-[24px] font-semibold text-cor-texto-principal font-mono tracking-tight">
              R$ 0,00
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-cor-branco p-[20px] rounded-[14px] border border-cor-borda shadow-card relative overflow-hidden hover:shadow-hover transition-all">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-erro to-transparent opacity-50"></div>
            <h3 className="text-[10.5px] text-cor-texto-mutado font-semibold uppercase tracking-wide mb-2.5 flex items-center gap-1">
              <i className="ph ph-arrow-up-right text-[14px]"></i>
              Despesas (Mês)
            </h3>
            <p className="text-[24px] font-semibold text-cor-texto-principal font-mono tracking-tight">
              R$ 0,00
            </p>
          </div>

          {/* Card 4 - Applicash */}
          <div className="bg-cor-branco p-[20px] rounded-[14px] border border-cor-borda shadow-card relative overflow-hidden hover:shadow-hover transition-all">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sb-accent to-transparent opacity-50"></div>
            <h3 className="text-[10.5px] text-cor-texto-mutado font-semibold uppercase tracking-wide mb-2.5 flex items-center gap-1">
              <i className="ph ph-currency-dollar text-[14px]"></i>
              Applicash $
            </h3>
            <p className="text-[24px] font-semibold text-cor-texto-principal font-mono tracking-tight">
              R$ 0,00
            </p>
          </div>
        </div>

        {/* Conteúdo Principal */}
        <div className="bg-cor-branco rounded-[14px] border border-cor-borda shadow-card p-6">
          <h2 className="font-syne text-lg font-bold text-cor-texto-principal mb-4">
            Bem-vindo à Appliquei!
          </h2>
          <p className="text-cor-texto-secundario text-sm mb-4">
            Comece a organizar suas finanças adicionando suas primeiras transações.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div className="p-4 bg-main-superficie rounded-[9px] border border-cor-borda">
              <h3 className="font-semibold text-cor-texto-principal text-sm mb-2 flex items-center gap-2">
                <i className="ph ph-plus-circle text-primaria"></i>
                Primeiros Passos
              </h3>
              <ul className="text-xs text-cor-texto-secundario space-y-2">
                <li>• Adicione suas receitas mensais</li>
                <li>• Registre suas despesas fixas</li>
                <li>• Configure suas metas financeiras</li>
                <li>• Conecte seus cartões de crédito</li>
              </ul>
            </div>
            
            <div className="p-4 bg-sb-accent-dim rounded-[9px] border border-sb-accent-border">
              <h3 className="font-semibold text-sb-accent text-sm mb-2 flex items-center gap-2">
                <i className="ph ph-currency-dollar"></i>
                Applicash $
              </h3>
              <p className="text-xs text-cor-texto-secundario mb-3">
                Indique amigos e ganhe 10% do valor pago por cada assinatura ativa.
              </p>
              <a
                href="/applicash"
                className="inline-flex items-center gap-2 text-xs font-semibold text-sb-accent hover:text-sb-accent transition-colors"
              >
                Saiba mais <i className="ph ph-arrow-right"></i>
              </a>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
