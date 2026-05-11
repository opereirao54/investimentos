'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getNomeMes } from '@/utils/finance';

interface MonthNavigatorProps {
  mesAtual: number; // 0-11
  anoAtual: number;
  onMesChange: (mes: number, ano: number) => void;
}

export function MonthNavigator({
  mesAtual,
  anoAtual,
  onMesChange,
}: MonthNavigatorProps) {
  const handleAnterior = () => {
    if (mesAtual === 0) {
      onMesChange(11, anoAtual - 1);
    } else {
      onMesChange(mesAtual - 1, anoAtual);
    }
  };

  const handleProximo = () => {
    if (mesAtual === 11) {
      onMesChange(0, anoAtual + 1);
    } else {
      onMesChange(mesAtual + 1, anoAtual);
    }
  };

  return (
    <div className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-4">
      {/* Botão Anterior */}
      <button
        onClick={handleAnterior}
        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-600 dark:text-zinc-400"
        aria-label="Mês anterior"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Display do Mês/Ano */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
          {getNomeMes(mesAtual)}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{anoAtual}</p>
      </div>

      {/* Botão Próximo */}
      <button
        onClick={handleProximo}
        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-600 dark:text-zinc-400"
        aria-label="Próximo mês"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
