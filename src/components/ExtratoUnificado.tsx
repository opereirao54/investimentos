'use client';

import React from 'react';
import { TransacaoFinanceira } from '@/types/finance';
import { formatarMoeda, formatarData } from '@/utils/format';
import { ArrowDownUp, ArrowUp, ArrowDown, Wallet } from 'lucide-react';

interface ExtratoUnificadoProps {
  transacoes: TransacaoFinanceira[];
}

export function ExtratoUnificado({ transacoes }: ExtratoUnificadoProps) {
  // Ordenar por data (mais recente primeiro)
  const transacoesOrdenadas = [...transacoes].sort((a, b) => {
    const dateA = new Date(a.data).getTime();
    const dateB = new Date(b.data).getTime();
    return dateB - dateA;
  });

  const getIconeTipo = (tipo: string) => {
    switch (tipo) {
      case 'receita':
        return <ArrowUp className="w-4 h-4 text-emerald-600" />;
      case 'despesa':
        return <ArrowDown className="w-4 h-4 text-red-600" />;
      case 'investimento':
        return <Wallet className="w-4 h-4 text-blue-600" />;
      default:
        return <ArrowDownUp className="w-4 h-4 text-zinc-600" />;
    }
  };

  const getCorLinha = (tipo: string) => {
    switch (tipo) {
      case 'receita':
        return 'bg-emerald-50/50 dark:bg-emerald-900/10';
      case 'despesa':
        return 'bg-red-50/50 dark:bg-red-900/10';
      case 'investimento':
        return 'bg-blue-50/50 dark:bg-blue-900/10';
      default:
        return '';
    }
  };

  if (transacoesOrdenadas.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-8 text-center">
        <ArrowDownUp className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-500 dark:text-zinc-400">
          Nenhuma transação neste mês.
        </p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
          Adicione receitas, despesas ou investimentos para ver o extrato.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Header da Tabela */}
      <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        <div className="col-span-3 sm:col-span-2">Data</div>
        <div className="col-span-5 sm:col-span-4">Descrição</div>
        <div className="col-span-2 hidden sm:block">Categoria</div>
        <div className="col-span-2 text-right">Valor</div>
      </div>

      {/* Lista de Transações */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {transacoesOrdenadas.map((transacao) => (
          <div
            key={transacao.id}
            className={`grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${getCorLinha(transacao.tipo)}`}
          >
            {/* Data */}
            <div className="col-span-3 sm:col-span-2 text-sm text-zinc-600 dark:text-zinc-300">
              {formatarData(transacao.data)}
            </div>

            {/* Ícone + Descrição */}
            <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
              <div className="flex-shrink-0">{getIconeTipo(transacao.tipo)}</div>
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {transacao.descricao}
              </span>
            </div>

            {/* Categoria (oculta em mobile) */}
            <div className="col-span-2 hidden sm:block">
              {transacao.categoria && (
                <span className="inline-block px-2 py-1 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {transacao.categoria}
                </span>
              )}
            </div>

            {/* Valor */}
            <div className="col-span-2 text-right">
              <span
                className={`text-sm font-bold ${
                  transacao.tipo === 'receita'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : transacao.tipo === 'despesa'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {transacao.tipo === 'despesa' ? '-' : ''}
                {formatarMoeda(transacao.valor)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer com total */}
      <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
          {transacoesOrdenadas.length}{' '}
          {transacoesOrdenadas.length === 1 ? 'transação' : 'transações'}{' '}
          neste mês
        </p>
      </div>
    </div>
  );
}
