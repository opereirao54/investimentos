// src/utils/finance.ts

import { TransacaoFinanceira, ResumoMensal } from '../types/finance';

/**
 * Filtra transações de um mês/ano específico
 */
export function filtrarTransacoesPorMes(
  transacoes: TransacaoFinanceira[],
  mes: number, // 0-11
  ano: number
): TransacaoFinanceira[] {
  return transacoes.filter((t) => {
    const data = new Date(t.data);
    // Ajuste de fuso horário para comparação correta
    const mesData = data.getMonth();
    const anoData = data.getFullYear();
    return mesData === mes && anoData === ano;
  });
}

/**
 * Calcula o resumo financeiro do mês (Regras originais mantidas)
 */
export function calcularResumoMensal(
  transacoes: TransacaoFinanceira[],
  mes: number,
  ano: number,
  receitaTotal?: number // Opcional: se vier de fora ou for calculado
): ResumoMensal {
  const transacoesMes = filtrarTransacoesPorMes(transacoes, mes, ano);

  const receitas = transacoesMes
    .filter((t) => t.tipo === 'receita')
    .reduce((acc, t) => acc + t.valor, 0);

  const despesas = transacoesMes
    .filter((t) => t.tipo === 'despesa')
    .reduce((acc, t) => acc + t.valor, 0);

  const investimentos = transacoesMes
    .filter((t) => t.tipo === 'investimento')
    .reduce((acc, t) => acc + t.valor, 0);

  // Saldo Livre = Receitas - Despesas - Investimentos
  const saldoLivre = receitas - despesas - investimentos;

  // Regra dos 60%: Limite baseado na Receita Bruta
  // Se não passar receitaTotal, usa a calculada
  const baseReceita = receitaTotal ?? receitas;
  const limiteSessentaPorcento = baseReceita * 0.6;

  // Cálculo do percentual utilizado em relação ao limite de 60%
  // Evitar divisão por zero
  const percentualUtilizado =
    limiteSessentaPorcento > 0
      ? (despesas / limiteSessentaPorcento) * 100
      : 0;

  return {
    mes,
    ano,
    receitas,
    despesas,
    investimentos,
    saldoLivre,
    limiteSessentaPorcento,
    percentualUtilizado,
  };
}

/**
 * Formata nome do mês
 */
export function getNomeMes(mes: number): string {
  const meses = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
  return meses[mes] || '';
}

/**
 * Determina a cor do termômetro baseada no percentual
 * Mantendo lógica visual original:
 * - Verde: <= 100% (dentro do limite)
 * - Amarelo/Laranja: 100% - 120% (atenção)
 * - Vermelho: > 120% (estouro)
 */
export function getCorTermometro(percentual: number): string {
  if (percentual <= 100) return 'bg-emerald-500'; // Verde original
  if (percentual <= 120) return 'bg-amber-500'; // Amarelo/Laranja
  return 'bg-red-500'; // Vermelho
}
