/**
 * Tipos e interfaces para o Motor Matemático do Appliquei
 */

export interface Operacao {
  ticker: string;
  tipo: 'compra' | 'venda';
  quantidade: number;
  preco: number;
  data_op?: string;
  categoria?: string;
  subcategoria?: string;
  corretora?: string;
  vencimento?: string;
  rentabilidade?: string;
  taxaMensal?: number;
}

export interface AtivoCarteira {
  qtdTotal: number;
  valorTotalInvestido: number;
  precoMedio: number;
  categoria: string | null;
  subcategoria: string | null;
  corretora: string | null;
  vencimento: string | null;
  rentabilidade: string | null;
}

export interface AtivoMercado {
  ticker: string;
  nome: string;
  tipo: 'Ação' | 'FII' | 'ETF' | 'BDR' | 'Renda Fixa';
  preco_atual: number;
}

export interface ResumoCarteira {
  [ticker: string]: AtivoCarteira;
}

export interface GrupoCategoria {
  investido: number;
  saldo: number;
  ativos: string[];
}

export interface ResultadoCalculoLucro {
  lucroReal: number;
  lucroPercentual: number;
  sinal: '+' | '-';
  cor: string;
}
