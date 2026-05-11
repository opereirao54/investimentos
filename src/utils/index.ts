/**
 * Barrel exports para utilitários do Appliquei
 */

// Formatação e máscaras
export {
  formatarMoeda,
  parseBRL,
  formatarBRLInput,
  aplicarMascaraBRL,
  setValorBRLInput,
  formatarQtd,
  parseQtd,
  aplicarMascaraQtd,
  setValorQtdInput,
  formatarData,
  formatarDataCurta,
  getTimestamp
} from './format';

// Matemática financeira (Carteira)
export {
  obterResumoCarteira,
  calcularLucroPrejuizo,
  calcularSaldoAtivo,
  obterPrecoAtual,
  calcularSaldoPrevidencia,
  consolidarCarteiraNaData,
  patrimonioNaData,
  aportesLiquidosNoPeriodo,
  agruparCarteiraPorCategoria,
  inferirCategoria,
  tipoMercadoParaSubcategoria,
  subcategoriaEfetiva,
  subcategoriaInferidaDoTicker,
  calcularRentabilidadePercentual,
  ativoEntraNoFiltroEvolucao
} from './math';

// Finanças Pessoais (Controle Mensal)
export {
  filtrarTransacoesPorMes,
  calcularResumoMensal,
  getNomeMes,
  getCorTermometro
} from './finance';

// Types - Carteira
export type {
  Operacao,
  AtivoCarteira,
  AtivoMercado,
  ResumoCarteira,
  GrupoCategoria,
  ResultadoCalculoLucro
} from '@/types/math';

// Types - Finanças
export type {
  TransacaoFinanceira,
  TipoTransacao,
  ResumoMensal
} from '@/types/finance';
