'use client';

import React, { useState } from 'react';
import { TransacaoFinanceira, ResumoMensal } from '@/types/finance';
import { calcularResumoMensal } from '@/utils/finance';
import { MonthNavigator } from './MonthNavigator';
import { Termometro60 } from './Termometro60';
import { ExtratoUnificado } from './ExtratoUnificado';
import { formatarMoeda } from '@/utils/format';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';

interface ControleFinanceiroProps {
  transacoes: TransacaoFinanceira[];
}

export function ControleFinanceiro({ transacoes }: ControleFinanceiroProps) {
  const hoje = new Date();
  const [mesSelecionado, setMesSelecionado] = useState(hoje.getMonth());
  const [anoSelecionado, setAnoSelecionado] = useState(hoje.getFullYear());

  // Calcular resumo do mês selecionado
  const resumo: ResumoMensal = calcularResumoMensal(
    transacoes,
    mesSelecionado,
    anoSelecionado
  );

  // Filtrar transações do mês para o extrato
  const transacoesDoMes = transacoes.filter((t) => {
    const data = new Date(t.data);
    return (
      data.getMonth() === mesSelecionado &&
      data.getFullYear() === anoSelecionado
    );
  });

  const handleMesChange = (novoMes: number, novoAno: number) => {
    setMesSelecionado(novoMes);
    setAnoSelecionado(novoAno);
  };

  return (
    <div className="space-y-6">
      {/* Navegação de Meses */}
      <MonthNavigator
        mesAtual={mesSelecionado}
        anoAtual={anoSelecionado}
        onMesChange={handleMesChange}
      />

      {/* Cards de Resumo Rápido */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Receitas */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-4">
          <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
            <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase font-semibold">
              Receitas
            </p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatarMoeda(resumo.receitas)}
            </p>
          </div>
        </div>

        {/* Despesas */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-4">
          <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
            <TrendingDown className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase font-semibold">
              Despesas
            </p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">
              {formatarMoeda(resumo.despesas)}
            </p>
          </div>
        </div>

        {/* Saldo Livre */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
            <Wallet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase font-semibold">
              Saldo Livre
            </p>
            <p
              className={`text-xl font-bold ${
                resumo.saldoLivre >= 0
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {formatarMoeda(resumo.saldoLivre)}
            </p>
          </div>
        </div>
      </div>

      {/* Termômetro dos 60% */}
      <Termometro60 resumo={resumo} />

      {/* Extrato Unificado */}
      <ExtratoUnificado transacoes={transacoesDoMes} />
    </div>
  );
}
