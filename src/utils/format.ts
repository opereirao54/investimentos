/**
 * Utilitários de formatação e máscaras para valores monetários (BRL - R$)
 * Traduzido fielmente do código original Appliquei v13.0
 */

/**
 * Formata um número como moeda brasileira (R$)
 * Ex: 1234.56 → "R$ 1.234,56"
 */
export function formatarMoeda(valor: number): string {
  return (valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Parseia uma string formatada em BRL para número
 * Ex: "R$ 1.234,56" ou "1.234,56" → 1234.56
 */
export function parseBRL(str: string | number | null | undefined): number {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  
  const limpo = String(str)
    .replace(/[^\d,-]/g, '')           // Remove tudo exceto dígitos, vírgula e menos
    .replace(/\.(?=\d{3}(\D|$))/g, '') // Remove pontos de milhar
    .replace(',', '.');                 // Converte vírgula decimal para ponto
  
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : n;
}

/**
 * Formata um número para o formato de input BRL (com 2 casas decimais)
 * Ex: 1234.567 → "1.234,57"
 */
export function formatarBRLInput(valor: number | string): string {
  const n = typeof valor === 'number' ? valor : parseBRL(valor);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Aplica a máscara BRL em um valor digitado (para uso em onChange de inputs)
 * Remove todos os caracteres não-dígitos e divide por 100 para obter o valor final
 * Ex: "123456" → "1.234,56"
 */
export function aplicarMascaraBRL(valor: string): string {
  const apenasDigitos = valor.replace(/\D/g, '');
  if (!apenasDigitos) return '';
  
  const numero = parseInt(apenasDigitos, 10) / 100;
  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Define o valor de um input BRL formatado
 * Usado para preencher inputs programaticamente
 */
export function setValorBRLInput(valor: number | string | null | undefined): string {
  if (valor === '' || valor == null) return '';
  return formatarBRLInput(valor);
}

/**
 * Formata quantidade com separador de milhar brasileiro
 * Ex: 1234567 → "1.234.567"
 */
export function formatarQtd(valor: number | string): string {
  const n = Number(valor) || 0;
  return n.toLocaleString('pt-BR');
}

/**
 * Parseia uma string de quantidade formatada para número
 * Ex: "1.234.567" → 1234567
 */
export function parseQtd(str: string | number | null | undefined): number {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  
  const limpo = String(str).replace(/\./g, '').replace(/,/g, '.');
  const n = parseFloat(limpo);
  return isNaN(n) ? 0 : n;
}

/**
 * Aplica a máscara de quantidade (inteiro com separador de milhar)
 * Ex: "1234567" → "1.234.567"
 */
export function aplicarMascaraQtd(valor: string): string {
  const apenasDigitos = valor.replace(/\D/g, '');
  if (!apenasDigitos) return '';
  
  const numero = parseInt(apenasDigitos, 10);
  return numero.toLocaleString('pt-BR');
}

/**
 * Define o valor de um input de quantidade formatado
 */
export function setValorQtdInput(valor: number | string | null | undefined): string {
  if (valor === '' || valor == null) return '';
  return Number(valor).toLocaleString('pt-BR');
}

/**
 * Formata data no padrão brasileiro
 * Ex: new Date('2024-01-15') → "15/01/2024"
 */
export function formatarData(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(data) : data;
  return d.toLocaleDateString('pt-BR');
}

/**
 * Formata data curta (mês abreviado)
 * Ex: new Date('2024-01-15') → "jan 2024"
 */
export function formatarDataCurta(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(data) : data;
  return d.toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric'
  }).replace('.', '');
}

/**
 * Extrai o timestamp de uma data (ou usa o atual)
 */
export function getTimestamp(data?: Date | string | number): number {
  if (data === undefined) return Date.now();
  if (typeof data === 'number') return data;
  return new Date(data).getTime();
}
