'use strict';

/**
 * Faturas de cartão SINTÉTICAS para testar a importação sem conta em banco
 * nenhum.
 *
 * Duas peças:
 *
 * 1. gerarHistorico(semente) inventa a vida de um cartão por vários meses: as
 *    compras (à vista e parceladas), os encargos (IOF, juros, anuidade), o
 *    estorno de uma compra na mesma fatura, o crédito de uma compra antiga, o
 *    pagamento da fatura anterior e, às vezes, saldo em atraso. A parcela
 *    avança de fatura em fatura como num banco de verdade, e a parcela antiga
 *    vem com a data do início do ciclo (o que o Nubank faz).
 *    linhasDaFatura(hist, k) devolve a VERDADE da fatura k: as linhas que o
 *    banco mostraria, e o que o app tem de fazer com cada uma.
 *
 * 2. renderizar(linhas, ...) escreve a mesma fatura em DIALETOS — as formas
 *    que os bancos usam para exportar: OFX SGML (Nubank), OFX XML, OFX numa
 *    linha só, OFX com vírgula decimal, e CSV com vírgula, ponto e vírgula,
 *    Latin-1, BOM, colunas em outra ordem, colunas a mais, parcela em coluna
 *    própria, sinal invertido, "R$" no valor, data DD/MM/AAAA.
 *
 * Quem usa: test/importar-fatura-dialetos.test.js (toda fatura × todo
 * dialeto lê exatamente a verdade) e test/_sequencias-importacao.js (a caça
 * de furos: meses de uso com Telegram, importação, reimportação e Desfazer).
 *
 * Tudo é determinístico pela semente: uma falha se reproduz igual.
 */

const { rng } = require('./_sequencias.js');

// Nomes que o motor NÃO pode confundir com tipo especial (pagamento, IOF,
// estorno...): nada de "pagamento", "saldo", "juros", "multa", "tarifa",
// "estorno", "parcela" aqui. Acentos e símbolos de propósito.
const LOJAS = [
  'Padaria Sol Nascente',
  'Mercado Bom Preço',
  'Posto Estrela',
  'Farmácia Saúde Já',
  'Restaurante Sabor & Cia',
  'Lanchonete do Zé',
  'Livraria Leitura',
  'Ótica Visão',
  'Esportes Total',
  'Loja Casa Nova',
  'Auto Peças Centro',
  'Pet Shop Amigo Fiel',
  'Cinema Central',
  'Academia Corpo em Forma',
  'Açougue São João',
  'Hortifruti Verde, Filial 2',
  'Bar "do Português"',
  'Doceria Açúcar Mascavo',
  'Eletrônicos Ponto Certo',
  'Cabeleireiro Estilo',
];

const FORMATOS_TITULO = [
  (n) => n,
  (n) => n,
  (n) => n,
  (n) => n.toUpperCase(),
  (n) =>
    'MP*' +
    n
      .replace(/[^A-Za-zÀ-ú0-9 ]/g, '')
      .replace(/ /g, '')
      .toUpperCase(),
  (n) => 'PAG*' + n,
  (n) => n + ' - NuPay',
  (n) => 'Asa*' + n,
];

function gerador(semente) {
  const r = rng(semente);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const um = (lista) => lista[Math.floor(r() * lista.length)];
  const chance = (p) => r() < p;
  const centavos = () => {
    const faixa = r();
    let v;
    if (faixa < 0.6)
      v = int(300, 15000) / 100; // R$ 3 a R$ 150
    else if (faixa < 0.9) v = int(15000, 80000) / 100;
    else v = int(100000, 450000) / 100; // milhar, para o separador de milhar
    if (chance(0.15)) v = Math.round(v); // valor redondo
    return Math.round(v * 100) / 100;
  };
  return { r, int, um, chance, centavos };
}

function ymd(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function data(ymdStr) {
  const [a, m, d] = ymdStr.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function somarDias(ymdStr, n) {
  const d = data(ymdStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/**
 * A vida de um cartão: `meses` faturas consecutivas.
 * → { semente, diaVenc, vencimentos[], compras[], extras[] }
 */
function gerarHistorico(semente, opcoes) {
  const o = opcoes || {};
  const g = gerador(semente);
  const meses = o.meses || 5;
  const diaVenc = g.um([3, 5, 8, 10, 12, 15, 20, 25, 28]);
  const ano = 2026;
  const mes0 = g.int(0, 6);
  const vencimentos = [];
  for (let k = 0; k < meses; k++) vencimentos.push(ymd(new Date(ano, mes0 + k + 1, diaVenc)));

  const compras = [];
  const extras = [];
  let seq = 0;
  for (let k = 0; k < meses; k++) {
    // Ciclo k: do fechamento anterior (+1) ao fechamento (7 dias antes do vencimento).
    const fim = somarDias(vencimentos[k], -7);
    const inicio = k === 0 ? somarDias(fim, -30) : somarDias(somarDias(vencimentos[k - 1], -7), 1);
    const dias = Math.round((data(fim) - data(inicio)) / 86400000);
    const dataNoCiclo = () => somarDias(inicio, g.int(0, Math.max(0, dias)));

    const nCompras = g.int(2, 10);
    for (let i = 0; i < nCompras; i++) {
      const loja = g.um(LOJAS);
      const parcelada = g.chance(0.25);
      const m = parcelada ? g.int(2, 12) : 1;
      compras.push({
        id: 'c' + seq++,
        ciclo: k,
        data: dataNoCiclo(),
        loja,
        titulo: g.um(FORMATOS_TITULO)(loja),
        valor: g.centavos(), // valor DA PARCELA quando parcelada
        m,
        tipo: 'compra',
      });
    }
    // Encargos: viram despesa "Impostos e Taxas".
    if (g.chance(0.3)) {
      const alvo = g.um(LOJAS);
      compras.push({
        id: 'c' + seq++,
        ciclo: k,
        data: dataNoCiclo(),
        loja: alvo,
        titulo: g.um([
          `IOF de "${alvo}"`,
          'Juros de dívida encerrada',
          'Anuidade',
          'Multa por atraso',
        ]),
        valor: g.int(50, 3000) / 100,
        m: 1,
        tipo: 'encargo',
      });
    }
    // Compra e estorno na MESMA fatura (D3a): se anulam.
    if (g.chance(0.3)) {
      const loja = g.um(LOJAS);
      const titulo = g.um(FORMATOS_TITULO)(loja);
      const id = 'c' + seq++;
      const valor = g.centavos();
      compras.push({
        id,
        ciclo: k,
        data: dataNoCiclo(),
        loja,
        titulo,
        valor,
        m: 1,
        tipo: 'compra',
        estornada: true,
      });
      extras.push({
        ciclo: k,
        tipo: 'estorno',
        data: fim,
        titulo: `Estorno de "${titulo}"`,
        valor: -valor,
        de: id,
      });
    }
    // Crédito de compra de fatura antiga (D3b): não entra.
    if (g.chance(0.15)) {
      extras.push({
        ciclo: k,
        tipo: 'credito_fora',
        data: dataNoCiclo(),
        titulo: 'Crédito de "Loja Antiga Ltda"',
        valor: -g.int(500, 9000) / 100,
      });
    }
    if (k > 0 || g.chance(0.5)) {
      extras.push({
        ciclo: k,
        tipo: 'pagamento',
        data: inicio,
        titulo: 'Pagamento recebido',
        valor: -g.int(10000, 500000) / 100,
      });
    }
    if (g.chance(0.05)) {
      extras.push({
        ciclo: k,
        tipo: 'saldo_anterior',
        data: inicio,
        titulo: 'Saldo em atraso',
        valor: g.int(1000, 50000) / 100,
      });
    }
  }
  // Crédito fora não pode ter o valor de uma compra da mesma fatura — senão
  // ele É o estorno dela, e a verdade muda. Desempata somando 1 centavo.
  extras.forEach((e) => {
    if (e.tipo !== 'credito_fora') return;
    while (compras.some((c) => c.ciclo === e.ciclo && Math.abs(c.valor + e.valor) < 0.005)) {
      e.valor = Math.round((e.valor - 0.01) * 100) / 100;
    }
  });
  return { semente, diaVenc, vencimentos, compras, extras };
}

/**
 * A VERDADE da fatura k, na ordem em que o banco lista (mais recente primeiro).
 * Cada linha: { data, titulo, valor (compra +, crédito −), tipo, compraId, n, m,
 * fitid, anulada }.
 */
function linhasDaFatura(hist, k) {
  const linhas = [];
  const cicloInicio = k === 0 ? null : somarDias(somarDias(hist.vencimentos[k - 1], -7), 1);
  hist.compras.forEach((c) => {
    if (c.m === 1) {
      if (c.ciclo !== k) return;
      linhas.push({
        data: c.data,
        titulo: c.titulo,
        valor: c.valor,
        tipo: c.tipo,
        compraId: c.id,
        n: 1,
        m: 1,
        fitid: c.id + '-1',
        anulada: !!c.estornada,
      });
      return;
    }
    const n = k - c.ciclo + 1;
    if (n < 1 || n > c.m) return;
    linhas.push({
      // Parcela antiga vem com a data do início do ciclo, como no Nubank.
      data: n === 1 || !cicloInicio ? c.data : cicloInicio,
      titulo: c.titulo + ' - Parcela ' + n + '/' + c.m,
      valor: c.valor,
      tipo: 'compra',
      compraId: c.id,
      n,
      m: c.m,
      fitid: c.id + '-' + n,
      anulada: false,
    });
  });
  hist.extras.forEach((e, i) => {
    if (e.ciclo !== k) return;
    linhas.push({
      data: e.data,
      titulo: e.titulo,
      valor: e.valor,
      tipo: e.tipo,
      compraId: e.de || null,
      n: 1,
      m: 1,
      fitid: 'e' + k + '-' + i,
      anulada: e.tipo === 'estorno',
    });
  });
  linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return linhas;
}

/** O que o app tem de ter desta fatura depois de importar num app vazio. */
function esperadoDaFatura(linhas) {
  const entram = linhas.filter((l) => (l.tipo === 'compra' || l.tipo === 'encargo') && !l.anulada);
  return {
    compras: entram.length,
    total: Math.round(entram.reduce((s, l) => s + l.valor, 0) * 100) / 100,
    lancamentos: entram.reduce((s, l) => s + (l.m > 1 ? l.m - l.n + 1 : 1), 0),
    ledger:
      Math.round(
        linhas.filter((l) => l.tipo !== 'pagamento').reduce((s, l) => s + l.valor, 0) * 100
      ) / 100,
  };
}

// ── Dialetos ───────────────────────────────────────────────────────────────

function br(v, milhar) {
  const s = Math.abs(v).toFixed(2).replace('.', ',');
  const [i, d] = s.split(',');
  const inteiro = milhar ? i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : i;
  return inteiro + ',' + d;
}

function aspasCsv(v, sep) {
  const s = String(v);
  return /["\n\r]/.test(s) || s.indexOf(sep) !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function dmy(ymdStr) {
  const [a, m, d] = ymdStr.split('-');
  return d + '/' + m + '/' + a;
}

function escOfx(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bytes(texto, codificacao) {
  if (codificacao === 'latin1') return Buffer.from(texto, 'latin1');
  if (codificacao === 'utf8bom')
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, 'utf8')]);
  return Buffer.from(texto, 'utf8');
}

function ofx(linhas, venc, cfg) {
  const nl = cfg.umaLinha ? '' : cfg.crlf ? '\r\n' : '\n';
  const fecha = (tag, v) => (cfg.xml ? `<${tag}>${v}</${tag}>` : `<${tag}>${v}`);
  const head = cfg.xml
    ? '<?xml version="1.0" encoding="UTF-8"?>' +
      nl +
      '<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE"?>' +
      nl
    : [
        'OFXHEADER:100',
        'DATA:OFXSGML',
        'VERSION:102',
        'SECURITY:NONE',
        'ENCODING:USASCII',
        'CHARSET:1252',
        'COMPRESSION:NONE',
        'OLDFILEUID:NONE',
        'NEWFILEUID:NONE',
        '',
      ].join(cfg.crlf ? '\r\n' : '\n');
  const p = [];
  p.push('<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>', fecha('CODE', '0'), '</STATUS>');
  p.push(
    '<FI>',
    fecha('ORG', cfg.org || 'NU PAGAMENTOS S.A.'),
    fecha('FID', cfg.fid || '260'),
    '</FI>',
    '</SONRS>',
    '</SIGNONMSGSRSV1>'
  );
  p.push(
    '<CREDITCARDMSGSRSV1>',
    '<CCSTMTTRNRS>',
    '<CCSTMTRS>',
    fecha('CURDEF', 'BRL'),
    '<BANKTRANLIST>'
  );
  linhas.forEach((l) => {
    const valor = (-l.valor).toFixed(2);
    p.push(
      '<STMTTRN>',
      fecha('TRNTYPE', l.valor > 0 ? 'DEBIT' : 'CREDIT'),
      fecha('DTPOSTED', l.data.replace(/-/g, '') + (cfg.semHora ? '' : '000000[-3:BRT]')),
      fecha('TRNAMT', cfg.virgula ? valor.replace('.', ',') : valor),
      fecha('FITID', l.fitid),
      fecha(cfg.tagNome || 'MEMO', escOfx(l.titulo)),
      '</STMTTRN>'
    );
  });
  p.push('</BANKTRANLIST>');
  if (cfg.ledger !== false) {
    const total = linhas.filter((l) => l.tipo !== 'pagamento').reduce((s, l) => s + l.valor, 0);
    p.push(
      '<LEDGERBAL>',
      fecha('BALAMT', (-total).toFixed(2)),
      fecha('DTASOF', venc.replace(/-/g, '')),
      '</LEDGERBAL>'
    );
  }
  p.push('</CCSTMTRS>', '</CCSTMTTRNRS>', '</CREDITCARDMSGSRSV1>', '</OFX>');
  return head + p.join(nl) + nl;
}

function csv(linhas, cfg) {
  const sep = cfg.sep || ',';
  const nl = cfg.crlf ? '\r\n' : '\n';
  const sinal = cfg.compraNegativa ? -1 : 1;
  const valorTxt = (v) => {
    const x = v * sinal;
    if (cfg.valor === 'br') return '"' + (x < 0 ? '- ' : '') + br(x, true) + '"';
    if (cfg.valor === 'br_sem_aspas') return (x < 0 ? '-' : '') + br(x, true);
    if (cfg.valor === 'reais') return (x < 0 ? '-R$ ' : 'R$ ') + br(x, true);
    return x.toFixed(2);
  };
  const dataTxt = (d) => (cfg.dmy ? dmy(d) : d);
  const colunas = cfg.colunas;
  const out = [colunas.map((c) => c.cabecalho).join(sep)];
  linhas.forEach((l) => {
    const parc = l.m > 1 ? l.titulo.match(/^(.*) - Parcela (\d+)\/(\d+)$/) : null;
    const campos = {
      data: dataTxt(l.data),
      titulo: cfg.parcelaEmColuna && parc ? parc[1] : l.titulo,
      valor: valorTxt(l.valor),
      parcela: cfg.parcelaEmColuna
        ? parc
          ? cfg.parcelaDe
            ? `${parc[2]} de ${parc[3]}`
            : `${parc[2]}/${parc[3]}`
          : ''
        : '',
      categoria: 'Outros',
      portador: 'TITULAR',
      final: '1234',
    };
    out.push(
      colunas
        .map((c) =>
          c.campo === 'valor' && /^"/.test(campos.valor)
            ? campos.valor
            : aspasCsv(campos[c.campo], sep)
        )
        .join(sep)
    );
  });
  return out.join(nl) + nl + (cfg.linhasVaziasNoFim ? nl + nl : '');
}

const C = (cabecalho, campo) => ({ cabecalho, campo });

/**
 * Cada dialeto: { nome, montar(linhas, venc) → { conteudo: Buffer, arquivo } }.
 * `vencNoNome`: o nome do arquivo traz o vencimento (como o Nubank faz).
 */
const DIALETOS = [
  {
    nome: 'ofx_nubank',
    vencNoNome: true,
    montar: (l, v) => ({
      conteudo: bytes(ofx(l, v, { crlf: true }), 'latin1'),
      arquivo: `Nubank_${v}.ofx`,
    }),
  },
  {
    nome: 'ofx_xml',
    montar: (l, v) => ({
      conteudo: bytes(
        ofx(l, v, {
          xml: true,
          tagNome: 'NAME',
          org: 'BANCO EXEMPLO S.A.',
          fid: '999',
          ledger: false,
        }),
        'utf8'
      ),
      arquivo: 'extrato-cartao.ofx',
    }),
  },
  {
    nome: 'ofx_uma_linha',
    montar: (l, v) => ({
      conteudo: bytes(ofx(l, v, { umaLinha: true, semHora: true }), 'latin1'),
      arquivo: 'fatura.ofx',
    }),
  },
  {
    nome: 'ofx_virgula',
    montar: (l, v) => ({
      conteudo: bytes(
        ofx(l, v, { virgula: true, tagNome: 'NAME', ledger: false, org: 'OUTRO BANCO' }),
        'latin1'
      ),
      arquivo: 'fatura.ofx',
    }),
  },
  {
    nome: 'csv_nubank',
    vencNoNome: true,
    montar: (l, v) => ({
      conteudo: bytes(
        csv(l, {
          valor: 'br',
          colunas: [C('date', 'data'), C('title', 'titulo'), C('amount', 'valor')],
        }),
        'utf8'
      ),
      arquivo: `Nubank_${v}.csv`,
    }),
  },
  {
    nome: 'csv_nubank_antigo',
    vencNoNome: true,
    montar: (l, v) => ({
      conteudo: bytes(
        csv(l, {
          colunas: [
            C('date', 'data'),
            C('category', 'categoria'),
            C('title', 'titulo'),
            C('amount', 'valor'),
          ],
        }),
        'utf8'
      ),
      arquivo: `Nubank_${v}.csv`,
    }),
  },
  {
    nome: 'csv_excel_br_latin1',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, {
          sep: ';',
          crlf: true,
          dmy: true,
          valor: 'br_sem_aspas',
          colunas: [C('Data', 'data'), C('Descrição', 'titulo'), C('Valor', 'valor')],
        }),
        'latin1'
      ),
      arquivo: 'fatura.csv',
    }),
  },
  {
    nome: 'csv_excel_utf8_bom',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, {
          sep: ';',
          dmy: true,
          valor: 'br_sem_aspas',
          linhasVaziasNoFim: true,
          colunas: [C('Data', 'data'), C('Lançamento', 'titulo'), C('Valor (R$)', 'valor')],
        }),
        'utf8bom'
      ),
      arquivo: 'fatura.csv',
    }),
  },
  {
    nome: 'csv_compra_negativa',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, {
          compraNegativa: true,
          colunas: [C('Data', 'data'), C('Descricao', 'titulo'), C('Valor', 'valor')],
        }),
        'utf8'
      ),
      arquivo: 'fatura.csv',
    }),
  },
  {
    nome: 'csv_colunas_extras_parcela',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, {
          parcelaEmColuna: true,
          valor: 'br',
          colunas: [
            C('Data da compra', 'data'),
            C('Portador', 'portador'),
            C('Final do cartão', 'final'),
            C('Estabelecimento', 'titulo'),
            C('Parcela', 'parcela'),
            C('Valor (R$)', 'valor'),
          ],
        }),
        'utf8'
      ),
      arquivo: 'fatura-cartao.csv',
    }),
  },
  {
    nome: 'csv_reais_parcela_de',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, {
          sep: ';',
          valor: 'reais',
          dmy: true,
          parcelaEmColuna: true,
          parcelaDe: true,
          colunas: [
            C('Data', 'data'),
            C('Histórico', 'titulo'),
            C('Parcelas', 'parcela'),
            C('Valor', 'valor'),
          ],
        }),
        'latin1'
      ),
      arquivo: 'fatura.csv',
    }),
  },
  {
    nome: 'csv_colunas_trocadas',
    montar: (l) => ({
      conteudo: bytes(
        csv(l, { colunas: [C('amount', 'valor'), C('title', 'titulo'), C('date', 'data')] }),
        'utf8'
      ),
      arquivo: 'fatura.csv',
    }),
  },
];

module.exports = {
  LOJAS,
  DIALETOS,
  gerador,
  gerarHistorico,
  linhasDaFatura,
  esperadoDaFatura,
  somarDias,
};
