// src/types/finance.ts

export type TipoTransacao = 'receita' | 'despesa' | 'investimento';

export interface TransacaoFinanceira {
  id: string;
  data: string; // ISO Date ou DD/MM/YYYY
  descricao: string;
  tipo: TipoTransacao;
  valor: number;
  categoria?: string;
  fixa?: boolean; // Para despesas recorrentes
}

export interface ResumoMensal {
  mes: number; // 0-11
  ano: number;
  receitas: number;
  despesas: number;
  investimentos: number;
  saldoLivre: number;
  limiteSessentaPorcento: number;
  percentualUtilizado: number;
}
