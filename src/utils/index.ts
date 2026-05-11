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

// Matemática financeira
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

// Types
export type {
  Operacao,
  AtivoCarteira,
  AtivoMercado,
  ResumoCarteira,
  GrupoCategoria,
  ResultadoCalculoLucro
} from '@/types/math';
