/**
 * Motor Matemático do Appliquei - Cálculos Financeiros
 * Traduzido fielmente do código original Appliquei v13.0
 * 
 * ZERO-REGRESSÃO: As fórmulas são matematicamente exatas às originais.
 */

import type { Operacao, AtivoCarteira, ResumoCarteira, AtivoMercado } from '@/types/math';

/**
 * Consolida o histórico de operações para obter o resumo da carteira
 * Calcula Preço Médio Ponderado exatamente como no original:
 * - Compras: aumenta quantidade e valor total, recalcula preço médio
 * - Vendas: reduz quantidade e valor total (pelo preço médio), sem alterar o preço médio unitário
 */
export function obterResumoCarteira(operacoes: Operacao[]): ResumoCarteira {
  const consolidado: Record<string, AtivoCarteira> = {};

  operacoes.forEach(op => {
    if (!consolidado[op.ticker]) {
      consolidado[op.ticker] = {
        qtdTotal: 0,
        valorTotalInvestido: 0,
        precoMedio: 0,
        categoria: null,
        subcategoria: null,
        corretora: null,
        vencimento: null,
        rentabilidade: null
      };
    }

    const ativo = consolidado[op.ticker];
    const tipo = op.tipo || 'compra';
    const precoDaOp = op.preco;

    if (tipo === 'compra') {
      ativo.qtdTotal += op.quantidade;
      ativo.valorTotalInvestido += (op.quantidade * precoDaOp);
      ativo.precoMedio = ativo.valorTotalInvestido / ativo.qtdTotal;

      // Última compra define metadados exibidos
      if (op.categoria) ativo.categoria = op.categoria;
      if (op.subcategoria) ativo.subcategoria = op.subcategoria;
      if (op.corretora) ativo.corretora = op.corretora;
      if (op.vencimento) ativo.vencimento = op.vencimento;
      if (op.rentabilidade) ativo.rentabilidade = op.rentabilidade;
    } else if (tipo === 'venda') {
      // Venda reduz pelo preço médio atual (não altera o custo médio das restantes)
      ativo.qtdTotal -= op.quantidade;
      ativo.valorTotalInvestido -= (op.quantidade * ativo.precoMedio);
    }
  });

  return consolidado;
}

/**
 * Calcula o lucro/prejuízo de um ativo
 * Retorna o valor em R$, percentual e informações de formatação
 */
export function calcularLucroPrejuizo(
  saldoAtual: number,
  valorTotalInvestido: number
): {
  lucroReal: number;
  lucroPercentual: number;
  sinal: '+' | '-';
  cor: 'var(--cor-primaria)' | 'var(--cor-erro)';
} {
  const lucroReal = saldoAtual - valorTotalInvestido;
  const lucroPercentual = valorTotalInvestido > 0 
    ? (lucroReal / valorTotalInvestido) * 100 
    : 0;
  
  return {
    lucroReal,
    lucroPercentual,
    sinal: lucroReal >= 0 ? '+' : '-',
    cor: lucroReal >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)'
  };
}

/**
 * Calcula o saldo de um ativo considerando o preço atual de mercado
 */
export function calcularSaldoAtivo(
  quantidade: number,
  precoAtual: number
): number {
  return quantidade * precoAtual;
}

/**
 * Obtém o preço atual de um ativo (do mercado ou fallback para preço médio)
 */
export function obterPrecoAtual(
  ticker: string,
  ativosMercado: AtivoMercado[],
  precoMedio: number
): number {
  const ativoMercado = ativosMercado.find(a => a.ticker === ticker);
  return ativoMercado ? ativoMercado.preco_atual : precoMedio;
}

/**
 * Calcula o saldo de previdência com juros compostos mensais
 * Fórmula original: cada aporte rende juros compostos desde a data do aporte até hoje
 */
export function calcularSaldoPrevidencia(
  ticker: string,
  operacoes: Operacao[],
  dataReferencia?: number
): number {
  const refTs = dataReferencia || Date.now();
  const aportes = operacoes.filter(
    op => op.ticker === ticker && 
          op.categoria === 'previdencia' && 
          op.data_op
  );

  let saldo = 0;

  aportes.forEach(op => {
    const dataAporte = new Date(op.data_op!).getTime();
    if (dataAporte > refTs) return;

    const taxa = op.taxaMensal != null ? op.taxaMensal : 0.008; // 0.8% ao mês default
    const meses = Math.max(0, (refTs - dataAporte) / (30.4375 * 24 * 60 * 60 * 1000));
    const valor = op.preco;
    const fator = Math.pow(1 + taxa, meses);

    if ((op.tipo || 'compra') === 'venda') {
      saldo -= valor * fator;
    } else {
      saldo += valor * fator;
    }
  });

  return saldo;
}

/**
 * Consolidar carteira numa data específica (para evolução patrimonial histórica)
 * Considera apenas operações com data <= dataLimite
 */
export function consolidarCarteiraNaData(
  operacoes: Operacao[],
  dataLimiteMs: number
): ResumoCarteira {
  const consolidado: ResumoCarteira = {};

  operacoes.forEach(op => {
    if (!op.data_op) return;
    if (new Date(op.data_op).getTime() > dataLimiteMs) return;

    if (!consolidado[op.ticker]) {
      consolidado[op.ticker] = {
        qtdTotal: 0,
        valorTotalInvestido: 0,
        precoMedio: 0,
        categoria: null,
        subcategoria: null,
        corretora: null,
        vencimento: null,
        rentabilidade: null
      };
    }

    const ativo = consolidado[op.ticker];
    const tipo = op.tipo || 'compra';
    const precoDaOp = op.preco;

    if (tipo === 'compra') {
      ativo.qtdTotal += op.quantidade;
      ativo.valorTotalInvestido += op.quantidade * precoDaOp;
      ativo.precoMedio = ativo.qtdTotal > 0 
        ? ativo.valorTotalInvestido / ativo.qtdTotal 
        : 0;
      
      if (op.categoria) ativo.categoria = op.categoria;
      if (op.subcategoria) ativo.subcategoria = op.subcategoria;
    } else if (tipo === 'venda') {
      ativo.qtdTotal -= op.quantidade;
      ativo.valorTotalInvestido -= op.quantidade * ativo.precoMedio;
    }
  });

  return consolidado;
}

/**
 * Calcula o patrimônio total numa data específica
 * Usa preços atuais de mercado (limitação: não há série histórica de preços)
 */
export function patrimonioNaData(
  operacoes: Operacao[],
  ativosMercado: AtivoMercado[],
  dataLimite: Date,
  filtroTipo?: string,
  filtroAtivo?: string
): number {
  const limiteMs = dataLimite ? dataLimite.getTime() : 0;
  if (limiteMs <= 0) return 0;

  const consolidado = consolidarCarteiraNaData(operacoes, limiteMs);
  let patrimonio = 0;

  for (const ticker in consolidado) {
    const ativo = consolidado[ticker];
    if (ativo.qtdTotal <= 0) continue;

    const am = ativosMercado.find(a => a.ticker === ticker);
    
    // Aplica filtros se fornecidos
    if (filtroTipo && filtroTipo !== 'todos') {
      const tipoAtivo = am?.tipo?.toLowerCase() || '';
      const categoriaMap: Record<string, string[]> = {
        'renda_variavel': ['ação', 'fii', 'etf', 'bdr'],
        'renda_fixa': ['renda fixa']
      };
      const tiposPermitidos = categoriaMap[filtroTipo] || [];
      if (!tiposPermitidos.includes(tipoAtivo)) continue;
    }

    if (filtroAtivo && ticker !== filtroAtivo) continue;

    if (ativo.categoria === 'previdencia') {
      patrimonio += calcularSaldoPrevidencia(ticker, operacoes, limiteMs);
    } else {
      const precoAtual = am ? am.preco_atual : ativo.precoMedio;
      patrimonio += ativo.qtdTotal * precoAtual;
    }
  }

  return patrimonio;
}

/**
 * Calcula o aporte líquido num período (compras - vendas)
 */
export function aportesLiquidosNoPeriodo(
  operacoes: Operacao[],
  dataInicio: Date,
  filtroTipo?: string,
  filtroAtivo?: string
): number {
  const inicioMs = dataInicio.getTime();
  let total = 0;

  operacoes
    .filter(op => op.data_op && new Date(op.data_op).getTime() >= inicioMs)
    .forEach(op => {
      // Aplica filtros se fornecidos
      if (filtroAtivo && op.ticker !== filtroAtivo) return;
      
      const valor = op.quantidade * op.preco;
      if (op.tipo === 'venda') {
        total -= valor;
      } else {
        total += valor;
      }
    });

  return total;
}

/**
 * Agrupa carteira por categoria para visualização
 */
export function agruparCarteiraPorCategoria(
  resumoCarteira: ResumoCarteira,
  ativosMercado: AtivoMercado[]
): Record<string, { investido: number; saldo: number; ativos: string[] }> {
  const grupos: Record<string, { investido: number; saldo: number; ativos: string[] }> = {};

  for (const ticker in resumoCarteira) {
    const ativo = resumoCarteira[ticker];
    if (ativo.qtdTotal <= 0) continue;

    const ativoMercado = ativosMercado.find(a => a.ticker === ticker);
    const categoria = inferirCategoria(ticker, ativo, ativoMercado);
    
    let chave: string;
    if (categoria === 'renda_variavel') {
      chave = subcategoriaEfetiva(ticker, ativo, ativoMercado);
    } else {
      chave = categoria;
    }

    if (!grupos[chave]) {
      grupos[chave] = { investido: 0, saldo: 0, ativos: [] };
    }

    let saldo: number;
    if (categoria === 'previdencia') {
      // Para previdência, seria necessário passar as operações
      // Aqui usamos uma aproximação pelo valor investido
      saldo = ativo.valorTotalInvestido;
    } else {
      const precoAtual = ativoMercado ? ativoMercado.preco_atual : ativo.precoMedio;
      saldo = ativo.qtdTotal * precoAtual;
    }

    grupos[chave].investido += ativo.valorTotalInvestido;
    grupos[chave].saldo += saldo;
    grupos[chave].ativos.push(ticker);
  }

  return grupos;
}

/**
 * Infere a categoria principal de um ativo
 */
export function inferirCategoria(
  ticker: string,
  ativo: AtivoCarteira,
  ativoMercado?: AtivoMercado | null
): string {
  // Categoria explícita tem precedência
  if (ativo.categoria) {
    if (['renda_fixa', 'reserva_emergencia', 'previdencia'].includes(ativo.categoria)) {
      return ativo.categoria;
    }
  }

  // Inferir do tipo de mercado
  if (ativoMercado) {
    if (ativoMercado.tipo === 'Renda Fixa') return 'renda_fixa';
    if (['Ação', 'FII', 'ETF', 'BDR'].includes(ativoMercado.tipo)) return 'renda_variavel';
  }

  // Inferir do ticker (ex: TESOURO_*)
  if (ticker.startsWith('TESOURO_')) return 'renda_fixa';

  // Default: renda variável
  return 'renda_variavel';
}

/**
 * Mapeia tipo do mercado para subcategoria de Renda Variável
 */
export function tipoMercadoParaSubcategoria(tipo: string): string | null {
  const mapa: Record<string, string> = {
    'FII': 'fiis',
    'BDR': 'bdrs',
    'ETF': 'etfs',
    'Ação': 'acoes'
  };
  return mapa[tipo] || null;
}

/**
 * Determina a subcategoria efetiva (prioridade: operação > inferência > ticker)
 */
export function subcategoriaEfetiva(
  ticker: string,
  ativo: AtivoCarteira,
  ativoMercado?: AtivoMercado | null
): string {
  if (ativo.subcategoria) return ativo.subcategoria;
  
  const m = ativoMercado ? tipoMercadoParaSubcategoria(ativoMercado.tipo) : null;
  if (m) return m;
  
  return subcategoriaInferidaDoTicker(ticker) || 'acoes';
}

/**
 * Infere subcategoria a partir do ticker (regras heurísticas)
 */
export function subcategoriaInferidaDoTicker(ticker: string): string | null {
  const upper = ticker.toUpperCase();
  
  // FIIs terminam com 11
  if (upper.endsWith('11')) return 'fiis';
  
  // ETFs comuns
  if (['BOVA11', 'IVVB11', 'SMAL11', 'HASH11'].includes(upper)) return 'etfs';
  
  // BDRs terminam com 34
  if (upper.endsWith('34')) return 'bdrs';
  
  // Ações terminam com 3, 4, 5, 6, 11 (mas 11 já foi capturado acima)
  if (/^[A-Z]{4}[3-6]$/.test(upper)) return 'acoes';
  
  return null;
}

/**
 * Calcula a rentabilidade percentual
 */
export function calcularRentabilidadePercentual(
  valorAtual: number,
  valorInvestido: number
): number {
  if (valorInvestido <= 0) return 0;
  return ((valorAtual - valorInvestido) / valorInvestido) * 100;
}

/**
 * Verifica se um ativo entra nos filtros de evolução patrimonial
 */
export function ativoEntraNoFiltroEvolucao(
  ticker: string,
  ativo: AtivoCarteira,
  ativoMercado?: AtivoMercado | null,
  filtroTipo?: string,
  filtroAtivo?: string
): boolean {
  if (filtroAtivo && ticker !== filtroAtivo) return false;
  
  if (filtroTipo && filtroTipo !== 'todos') {
    const categoria = inferirCategoria(ticker, ativo, ativoMercado);
    
    if (filtroTipo === 'renda_variavel') {
      return categoria === 'renda_variavel';
    }
    if (filtroTipo === 'renda_fixa') {
      return categoria === 'renda_fixa' || categoria === 'reserva_emergencia';
    }
    if (filtroTipo === 'previdencia') {
      return categoria === 'previdencia';
    }
  }
  
  return true;
}
