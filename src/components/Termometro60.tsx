'use client';

import React from 'react';
import { ResumoMensal } from '@/types/finance';
import { getCorTermometro } from '@/utils/finance';
import { formatarMoeda } from '@/utils/format';

interface Termometro60Props {
  resumo: ResumoMensal;
}

export function Termometro60({ resumo }: Termometro60Props) {
  const { despesas, limiteSessentaPorcento, percentualUtilizado } = resumo;

  // Clamp do percentual para não estourar visualmente a barra (max 100% width)
  const percentualVisual = Math.min(percentualUtilizado, 100);
  const corBarra = getCorTermometro(percentualUtilizado);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          Termômetro dos 60%
        </h3>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${
            percentualUtilizado <= 100
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : percentualUtilizado <= 120
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {percentualUtilizado.toFixed(1)}% do limite
        </span>
      </div>

      {/* Valores */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            Despesas do Mês
          </p>
          <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
            {formatarMoeda(despesas)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            Limite (60% da Receita)
          </p>
          <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
            {formatarMoeda(limiteSessentaPorcento)}
          </p>
        </div>
      </div>

      {/* Barra de Progresso */}
      <div className="relative h-4 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        {/* Marca dos 100% */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-zinc-400 dark:bg-zinc-600 z-10"
          style={{ left: '100%' }}
        />

        {/* Barra Colorida */}
        <div
          className={`h-full ${corBarra} transition-all duration-500 ease-out`}
          style={{ width: `${percentualVisual}%` }}
        />
      </div>

      {/* Legendas */}
      <div className="flex justify-between mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>0%</span>
        <span className={percentualUtilizado > 100 ? 'text-red-500 font-bold' : ''}>
          100% (Limite)
        </span>
      </div>

      {/* Mensagem de Status */}
      {percentualUtilizado > 100 && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400 font-medium">
          ⚠️ Você ultrapassou o limite de 60% em{' '}
          {formatarMoeda(despesas - limiteSessentaPorcento)}!
        </p>
      )}
      {percentualUtilizado <= 100 && percentualUtilizado > 85 && (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400 font-medium">
          ⚠️ Atenção: Você está próximo do limite de 60%.
        </p>
      )}
      {percentualUtilizado <= 85 && (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
          ✅ Suas despesas estão dentro do limite recomendado.
        </p>
      )}
    </div>
  );
}
