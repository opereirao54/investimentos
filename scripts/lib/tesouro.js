'use strict';

/**
 * Taxas do Tesouro Direto a partir do CSV do Tesouro Transparente.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   O endpoint que alimentava `op=rendafixa` foi desativado. A sonda no
 *   runner registou, sem ambiguidade:
 *
 *     https://www.tesourodireto.com.br/json/.../treasurybondsinfo.json
 *     HTTP 410 · text/html · 4 bytes · corpo: "gone"
 *
 *   410 é "foi-se e não volta". O substituto é o dado aberto oficial, no
 *   mesmo portal CKAN que publica o resto do Tesouro Transparente.
 *
 * POR QUE NO JOB E NÃO NA FUNCTION
 *   O CSV é a série histórica INTEIRA desde 2002 — 14,4 MB medidos. Baixar
 *   isso a cada 12 h dentro dos 15 s e 256 MB do Vercel Hobby seria caro e
 *   frágil. O job já baixa ZIPs maiores da CVM sem apertar, e já escreve no
 *   Firestore. `op=rendafixa` passa a ler o que o job deixou.
 *
 * O QUE O ARQUIVO TEM (cabeçalho real, lido no log):
 *   Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;
 *   PU Compra Manha;PU Venda Manha;PU Base Manha
 */

const COLUNAS = [
  'Tipo Titulo',
  'Data Vencimento',
  'Data Base',
  'Taxa Compra Manha',
  'Taxa Venda Manha',
  'PU Compra Manha',
  'PU Venda Manha',
  'PU Base Manha',
];

/** `13,63` → 13.63. Vírgula decimal, como todo dado público brasileiro. */
function num(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** `01/10/2027` → `2027-10-01`. ISO ordena como texto; dd/MM/yyyy não. */
function data(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * O CSV inteiro → um título por (tipo, vencimento), no dia mais recente.
 *
 * O arquivo tem uma linha por título POR DIA desde 2002. Ler a última linha
 * do arquivo não resolve: ele vem ordenado por tipo e vencimento, não por
 * data, então o fim do arquivo é o último título do alfabeto — não o pregão
 * de hoje. Por isso a varredura é completa, guardando o máximo de `Data
 * Base` por chave.
 *
 * `hojeIso` entra por parâmetro para o teste não depender do relógio.
 */
function extrairTaxasTesouro(texto, hojeIso) {
  const linhas = String(texto || '').split(/\r?\n/);
  const cabecalho = (linhas[0] || '').split(';').map((c) => c.trim());
  const idx = {};
  for (const nome of COLUNAS) idx[nome] = cabecalho.indexOf(nome);

  const faltando = COLUNAS.filter((c) => idx[c] === -1);
  // Sem as três colunas essenciais não há o que extrair. As de PU são
  // desejáveis, não indispensáveis — e dizer QUAIS faltaram é o que separa
  // "o arquivo mudou" de "o arquivo está vazio" na próxima investigação.
  const essenciais = ['Tipo Titulo', 'Data Vencimento', 'Data Base', 'Taxa Compra Manha'];
  const semEssencial = essenciais.filter((c) => idx[c] === -1);
  if (semEssencial.length) {
    return { titulos: [], faltando, semEssencial, linhas: linhas.length, cabecalho };
  }

  const porChave = new Map();
  let lidas = 0;
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const campos = l.split(';');
    const tipo = (campos[idx['Tipo Titulo']] || '').trim();
    const venc = data(campos[idx['Data Vencimento']]);
    const base = data(campos[idx['Data Base']]);
    const taxaCompra = num(campos[idx['Taxa Compra Manha']]);
    if (!tipo || !venc || !base || taxaCompra === null) continue;
    lidas++;

    const chave = `${tipo}|${venc}`;
    const anterior = porChave.get(chave);
    if (anterior && anterior.dataBase >= base) continue;
    porChave.set(chave, {
      tipo,
      vencimento: venc,
      dataBase: base,
      taxaCompra,
      taxaVenda: idx['Taxa Venda Manha'] >= 0 ? num(campos[idx['Taxa Venda Manha']]) : null,
      puCompra: idx['PU Compra Manha'] >= 0 ? num(campos[idx['PU Compra Manha']]) : null,
    });
  }

  // Título vencido não é oferta: publicá-lo faria a tela recomendar a compra
  // de um papel que não existe mais. O arquivo guarda o histórico completo,
  // e é por isso que o corte é obrigatório e não uma otimização.
  const vivos = [];
  let vencidos = 0;
  for (const t of porChave.values()) {
    if (hojeIso && t.vencimento < hojeIso) {
      vencidos++;
      continue;
    }
    vivos.push(t);
  }
  vivos.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.tipo.localeCompare(b.tipo));

  return {
    titulos: vivos.map((t) => ({
      // Nome no mesmo formato do endpoint antigo — "Tesouro IPCA+ 2035" — para
      // o casamento com a carteira modelo continuar a valer sem tabela nova.
      nome: `${t.tipo} ${t.vencimento.slice(0, 4)}`,
      ticker: `${t.tipo} ${t.vencimento.slice(0, 4)}`
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      // Taxa de COMPRA: é a que o investidor contrata ao comprar. A de venda
      // fica junto porque a diferença entre as duas (4 bp na amostra) é o
      // spread, e vê-la no log é o que permite conferir que a leitura não
      // inverteu as colunas.
      taxa: t.taxaCompra,
      taxaVenda: t.taxaVenda,
      vencimento: t.vencimento,
      dataBase: t.dataBase,
      precoUnitario: t.puCompra,
      // O CSV não traz aplicação mínima. Derivá-la de uma regra que eu
      // lembro de cabeça seria inventar número — fica nulo, e a tela mostra
      // travessão em vez de um valor que ninguém conferiu.
      investimentoMinimo: null,
    })),
    faltando,
    semEssencial: [],
    linhasLidas: lidas,
    vencidos,
    cabecalho,
  };
}

module.exports = { extrairTaxasTesouro, COLUNAS_TESOURO: COLUNAS };
