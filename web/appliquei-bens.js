/**
 * Appliquei — Cadastro de Bens (imóveis, veículos, outros).
 *
 * Classic script. Carregado DEPOIS de appliquei-contas.js e ANTES de
 * appliquei-patrimonio.js. Persiste em localStorage 'appliquei_bens'
 * (auto-sincronizado pelo cloud-sync via prefixo appliquei_*).
 *
 * Integração com a API FIPE (parallelum) para veículos: busca marca,
 * modelo, ano e valor de referência automaticamente.
 */

// ============================================================
// === CADASTRO DE BENS                                      ===
// ============================================================

var bens = (function () {
  try {
    var arr = JSON.parse(localStorage.getItem('appliquei_bens'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
})();

var BEM_TIPOS = [
  { v: 'veiculo', label: 'Veículo', icon: 'ph-car-simple' },
  { v: 'imovel', label: 'Imóvel', icon: 'ph-house-line' },
  { v: 'outro', label: 'Outro', icon: 'ph-package' },
];

var BEM_VEICULO_TIPOS = [
  { v: 'carros', label: 'Carro', icon: 'ph-car-simple' },
  { v: 'motos', label: 'Moto', icon: 'ph-motorcycle' },
  { v: 'caminhoes', label: 'Caminhão', icon: 'ph-truck' },
];

var FIPE_BASE = 'https://parallelum.com.br/fipe/api/v1';

var BEM_IMOVEL_TIPOS = [
  { v: 'apartamento', label: 'Apartamento' },
  { v: 'casa', label: 'Casa' },
  { v: 'terreno', label: 'Terreno' },
  { v: 'sala_comercial', label: 'Sala comercial' },
  { v: 'galpao', label: 'Galpão' },
  { v: 'rural', label: 'Imóvel rural' },
  { v: 'outro', label: 'Outro' },
];

// Busca de CEP: ViaCEP como principal, BrasilAPI como reserva. As duas são
// públicas e sem chave. Só preenchem ENDEREÇO — valor por m² não existe em API
// pública no Brasil (FipeZAP é publicação, não API), por isso a referência de
// R$/m² é um campo que o usuário informa.
var CEP_ENDPOINTS = [
  {
    url: function (cep) {
      return 'https://viacep.com.br/ws/' + cep + '/json/';
    },
    parse: function (d) {
      if (!d || d.erro) return null;
      return {
        logradouro: d.logradouro || '',
        bairro: d.bairro || '',
        cidade: d.localidade || '',
        uf: d.uf || '',
      };
    },
  },
  {
    url: function (cep) {
      return 'https://brasilapi.com.br/api/cep/v1/' + cep;
    },
    parse: function (d) {
      if (!d || !d.city) return null;
      return {
        logradouro: d.street || '',
        bairro: d.neighborhood || '',
        cidade: d.city || '',
        uf: d.state || '',
      };
    },
  },
];
var _cepCache = {};

// ============================================================
// === PERSISTÊNCIA                                          ===
// ============================================================

function salvarBens() {
  try {
    localStorage.setItem('appliquei_bens', JSON.stringify(bens));
  } catch (e) {}
  try {
    if (window.AppliqueiCloudSync && typeof AppliqueiCloudSync.forceFlush === 'function') {
      AppliqueiCloudSync.forceFlush();
    }
  } catch (e) {}
}

// ============================================================
// === CRUD                                                  ===
// ============================================================

function criarBem(dados) {
  dados = dados || {};
  var nome = (dados.nome || '').trim();
  if (!nome) return null;
  var agora = new Date().toISOString();
  var novo = {
    id: 'bem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nome: nome,
    tipo: dados.tipo || 'outro',
    descricao: (dados.descricao || '').trim(),
    valorAtual: Number(dados.valorAtual) || 0,
    valorCompra: Number(dados.valorCompra) || 0,
    dataCompra: dados.dataCompra || null,
    fipe: dados.fipe || null,
    imovel: dados.imovel || null,
    financiamento: dados.financiamento || null,
    arquivado: false,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  bens.push(novo);
  salvarBens();
  return novo;
}

function obterBem(id) {
  for (var i = 0; i < bens.length; i++) {
    if (bens[i].id === id) return bens[i];
  }
  return null;
}

function editarBem(id, patch) {
  var b = obterBem(id);
  if (!b) return null;
  patch = patch || {};
  if (patch.nome != null) b.nome = String(patch.nome).trim() || b.nome;
  if (patch.tipo != null) b.tipo = patch.tipo;
  if (patch.descricao != null) b.descricao = String(patch.descricao).trim();
  if (patch.valorAtual != null) b.valorAtual = Number(patch.valorAtual) || 0;
  if (patch.valorCompra != null) b.valorCompra = Number(patch.valorCompra) || 0;
  if (patch.dataCompra !== undefined) b.dataCompra = patch.dataCompra;
  if (patch.fipe !== undefined) b.fipe = patch.fipe;
  // `!== undefined` (e não `!= null`) para que passar null LIMPE o bloco —
  // é assim que trocar o tipo de imóvel para veículo descarta CEP/área, em vez
  // de deixá-los pendurados num bem que não é imóvel.
  if (patch.imovel !== undefined) b.imovel = patch.imovel;
  // Mesma regra do imovel: null LIMPA, para desmarcar "financiado" quitar o bem.
  if (patch.financiamento !== undefined) b.financiamento = patch.financiamento;
  if (patch.arquivado != null) b.arquivado = !!patch.arquivado;
  b.atualizadoEm = new Date().toISOString();
  salvarBens();
  return b;
}

function excluirBem(id) {
  bens = bens.filter(function (b) {
    return b.id !== id;
  });
  salvarBens();
}

function bensAtivos() {
  return bens.filter(function (b) {
    return !b.arquivado;
  });
}

function totalBensAtual() {
  return bensAtivos().reduce(function (s, b) {
    return s + (b.valorAtual || 0);
  }, 0);
}

// ============================================================
// === FIPE API                                              ===
// ============================================================

var _fipeCache = {};

function fipeFetch(path) {
  if (_fipeCache[path]) return Promise.resolve(_fipeCache[path]);
  return fetch(FIPE_BASE + path)
    .then(function (r) {
      if (!r.ok) throw new Error('FIPE ' + r.status);
      return r.json();
    })
    .then(function (data) {
      _fipeCache[path] = data;
      return data;
    });
}

function fipeMarcas(tipoVeiculo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas');
}

function fipeModelos(tipoVeiculo, marcaCodigo) {
  return fipeFetch('/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos');
}

function fipeAnos(tipoVeiculo, marcaCodigo, modeloCodigo) {
  return fipeFetch(
    '/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos'
  );
}

function fipeValor(tipoVeiculo, marcaCodigo, modeloCodigo, anoCodigo) {
  return fipeFetch(
    '/' + tipoVeiculo + '/marcas/' + marcaCodigo + '/modelos/' + modeloCodigo + '/anos/' + anoCodigo
  );
}

// ============================================================
// === UI — FORMULÁRIO                                       ===
// ============================================================

// ============================================================
// === FINANCIAMENTO — cálculo                               ===
// ============================================================
// Dois sistemas, porque a conta muda muito entre eles:
//   PRICE — parcela fixa; os juros de cada parcela caem e a amortização sobe.
//           É o padrão de financiamento de veículo.
//   SAC   — amortização constante; a parcela começa alta e cai todo mês.
//           É o padrão da Caixa para imóvel.
// Usar Price num contrato SAC superestima os juros futuros em dezenas de
// milhares de reais num financiamento longo — por isso o sistema é escolhido,
// não presumido.
//
// Todas as funções abaixo são puras: recebem números, devolvem números. É o
// que permite testá-las sem DOM e o que mantém a tela burra.

var FIN_SISTEMAS = [
  { v: 'sac', label: 'SAC (parcela cai todo mês)' },
  { v: 'price', label: 'Price (parcela fixa)' },
];

// Juros que ainda serão pagos até quitar, e o total desembolsado no caminho.
function finJurosRestantes(sistema, saldoDevedor, taxaMensal, parcelas) {
  var sd = Number(saldoDevedor) || 0;
  var i = Number(taxaMensal) || 0;
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (sd <= 0 || n <= 0) return 0;
  if (i <= 0) return 0;
  if (sistema === 'price') {
    var pmt = finParcelaPrice(sd, i, n);
    return Math.max(0, pmt * n - sd);
  }
  // SAC: soma dos juros = i × A × n(n+1)/2, com A = sd/n  →  i × sd × (n+1)/2
  return (i * sd * (n + 1)) / 2;
}

// Parcela do Price: PMT = SD × i / (1 − (1+i)^−n)
function finParcelaPrice(saldoDevedor, taxaMensal, parcelas) {
  var sd = Number(saldoDevedor) || 0;
  var i = Number(taxaMensal) || 0;
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (sd <= 0 || n <= 0) return 0;
  if (i <= 0) return sd / n;
  return (sd * i) / (1 - Math.pow(1 + i, -n));
}

// SAC: a primeira parcela é a maior — é ela que o usuário reconhece no boleto.
function finPrimeiraParcelaSac(saldoDevedor, taxaMensal, parcelas) {
  var sd = Number(saldoDevedor) || 0;
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (sd <= 0 || n <= 0) return 0;
  return sd / n + sd * (Number(taxaMensal) || 0);
}

function finParcelaEsperada(sistema, saldoDevedor, taxaMensal, parcelas) {
  return sistema === 'price'
    ? finParcelaPrice(saldoDevedor, taxaMensal, parcelas)
    : finPrimeiraParcelaSac(saldoDevedor, taxaMensal, parcelas);
}

// Caminho inverso: dada a parcela que a pessoa informou, qual taxa mensal
// explicaria esse valor? Serve para dizer "a sua parcela indica 0,74% ao mês"
// em vez de só "os dados não fecham" — o número que resolve a dúvida.
// Devolve null quando nenhuma taxa explica a parcela (ex.: parcela menor que a
// dívida dividida pelo prazo, que é o piso sem juros nenhum).
function finTaxaImplicita(sistema, saldoDevedor, parcela, parcelas) {
  var sd = Number(saldoDevedor) || 0;
  var p = Number(parcela) || 0;
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (sd <= 0 || n <= 0 || p <= 0) return null;
  var semJuros = sd / n;
  if (p <= semJuros) return null;
  // SAC: parcela₁ = sd/n + sd × i  →  i = (parcela − sd/n) / sd
  if (sistema !== 'price') return (p - semJuros) / sd;
  // Price não tem forma fechada para i. A parcela cresce junto com a taxa,
  // então bissecção em (0, 100% ao mês] converge sempre.
  var lo = 0;
  var hi = 1;
  if (finParcelaPrice(sd, hi, n) < p) return null;
  for (var k = 0; k < 80; k++) {
    var mid = (lo + hi) / 2;
    if (finParcelaPrice(sd, mid, n) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Por que os números não fecham? Duas confusões explicam quase todo caso real:
// digitar a taxa do ANO no campo do mês, ou perder uma casa decimal (7,3 no
// lugar de 0,73). Apontar qual delas é vale muito mais que um aviso genérico.
// 'anual' | 'decimal' | null (não dá para afirmar).
function finDiagnosticoTaxa(taxaInformada, taxaImplicita) {
  var inf = Number(taxaInformada) || 0;
  var imp = Number(taxaImplicita) || 0;
  if (inf <= 0 || imp <= 0) return null;
  var perto = function (a, b) {
    return b > 0 && Math.abs(a - b) / b <= 0.15;
  };
  // Testado antes do decimal: a taxa anual simples é 12× a mensal e cairia
  // dentro da faixa do decimal, mas a explicação certa é a outra.
  if (perto(inf, Math.pow(1 + imp, 12) - 1) || perto(inf, imp * 12)) return 'anual';
  var razao = inf / imp;
  if (razao >= 8 && razao <= 12) return 'decimal';
  return null;
}

// O saldo devedor de hoje e o total que falta pagar são coisas diferentes — o
// segundo já embute os juros de todo o contrato — e o app do banco mostra os
// dois lado a lado. Copiar o de baixo é o engano mais comum depois da taxa, e
// tem assinatura limpa: saldo ≈ parcela × parcelas restantes.
function finSaldoPareceTotalAPagar(saldoDevedor, parcela, parcelas) {
  var sd = Number(saldoDevedor) || 0;
  var p = Number(parcela) || 0;
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (sd <= 0 || p <= 0 || n <= 0) return false;
  return Math.abs(sd - p * n) / sd <= 0.05;
}

// QUAL TAXA A TELA VAI USAR.
//
// São quatro dados (saldo, parcela, taxa, prazo) para um sistema de três
// incógnitas: um deles sobra, e quando não fecham alguém tem que decidir em
// quem acreditar. Eles não são igualmente confiáveis:
//
//   parcela   — debita na conta todo mês, está no extrato. A pessoa sabe.
//   prazo     — "faltam 45 de 60", no app do banco.
//   saldo     — no extrato, mas confunde-se com o "total a pagar".
//   taxa      — o contrato traz nominal a.a., efetiva a.a., CET a.a. e CET
//               a.m.; a pessoa escolhe uma e converte. É a que mais erra.
//
// Por isso a taxa é opcional: sem ela, deduzimos da parcela. Com ela e havendo
// conflito, o padrão é acreditar na parcela — mas a escolha fica com o usuário
// (fonteVerdade), porque quem sabe que digitou a taxa certa precisa poder dizer.
//
// Ressalva embutida: a parcela do boleto não é só amortização + juros; carrega
// seguro (MIP/DFI), taxa de administração e, em imóvel, correção. Por isso a
// taxa deduzida sai por CIMA, e `segurosTarifas` permite descontar essa parte
// antes de inverter a conta.
function finResolverTaxa(fin) {
  fin = fin || {};
  var sistema = fin.sistema === 'price' ? 'price' : 'sac';
  var sd = Number(fin.saldoDevedor) || 0;
  var n = Math.max(0, Math.round(Number(fin.parcelasRestantes) || 0));
  var seguros = Math.max(0, Number(fin.segurosTarifas) || 0);
  var parcelaCheia = Math.max(0, Number(fin.valorParcela) || 0);
  var parcelaLiquida = parcelaCheia > 0 ? Math.max(0, parcelaCheia - seguros) : 0;
  // `taxaInformada` é o que foi digitado; `taxaMensal` cobre os registros
  // gravados antes de a taxa virar opcional, quando só existia o campo digitado.
  var informada = Number(
    fin.taxaInformada !== undefined && fin.taxaInformada !== null
      ? fin.taxaInformada
      : fin.taxaMensal
  );
  if (!isFinite(informada) || informada < 0) informada = 0;

  var implicita = finTaxaImplicita(sistema, sd, parcelaLiquida, n);
  var parcelaEsperada = informada > 0 ? finParcelaEsperada(sistema, sd, informada, n) : 0;

  // Conflito é a parcela discordar da taxa — medido nas parcelas, que é o que a
  // pessoa vê. Vale mesmo quando nenhuma taxa explica a parcela (implicita
  // null): aí não há escolha a oferecer, mas continua havendo o que avisar.
  var conflito = false;
  if (informada > 0 && parcelaLiquida > 0 && parcelaEsperada > 0) {
    conflito = Math.abs(parcelaLiquida - parcelaEsperada) / parcelaEsperada > 0.1;
  }
  var escolha =
    conflito && implicita !== null ? (fin.fonteVerdade === 'taxa' ? 'taxa' : 'parcela') : null;

  var taxa;
  var origem;
  if (escolha) {
    taxa = escolha === 'taxa' ? informada : implicita;
    origem = escolha === 'taxa' ? 'informada' : 'derivada';
  } else if (informada > 0) {
    taxa = informada;
    origem = 'informada';
  } else if (implicita !== null) {
    taxa = implicita;
    origem = 'derivada';
  } else {
    taxa = 0;
    origem = 'nenhuma';
  }

  return {
    taxaMensal: taxa,
    origem: origem,
    escolha: escolha,
    conflito: conflito,
    causa: conflito ? finDiagnosticoTaxa(informada, implicita) : null,
    taxaInformada: informada,
    taxaImplicita: implicita,
    parcelaCheia: parcelaCheia,
    parcelaLiquida: parcelaLiquida,
    segurosTarifas: seguros,
    parcelaEsperada: parcelaEsperada,
    saldoPareceTotal: finSaldoPareceTotalAPagar(sd, parcelaCheia, n),
  };
}

// Um bem gravado ANTES de a taxa virar opcional pode carregar uma taxa que não
// combina com a própria parcela — e ninguém perguntou nada a quem cadastrou.
// Enquanto isso não for revisado, tudo que lê `taxaMensal` (a simulação de
// antecipação, principalmente) está prometendo número errado. `fonteVerdade`
// só existe em registro escrito pela tela nova, então a ausência dele é a
// marca exata de "nunca foi perguntado".
function finConflitoNaoRevisado(fin) {
  if (!fin || !fin.ativo) return false;
  if (fin.fonteVerdade !== undefined) return false;
  return finResolverTaxa(fin).conflito;
}

// Retrato do financiamento hoje.
function finResumo(fin, valorMercado) {
  fin = fin || {};
  var sd = Number(fin.saldoDevedor) || 0;
  var n = Math.max(0, Math.round(Number(fin.parcelasRestantes) || 0));
  var pago = Number(fin.valorPago) || 0;
  var sistema = fin.sistema === 'price' ? 'price' : 'sac';

  var taxa = finResolverTaxa(fin);
  var i = taxa.taxaMensal;

  var juros = finJurosRestantes(sistema, sd, i, n);
  var aPagar = sd + juros;

  return {
    sistema: sistema,
    saldoDevedor: sd,
    jurosRestantes: juros,
    totalAPagar: aPagar,
    custoTotal: pago + aPagar,
    valorPago: pago,
    // A parcela que a taxa EM USO produz — com conflito resolvido pela parcela,
    // ela reproduz a informada; resolvido pela taxa, mostra a diferença.
    parcelaEsperada: finParcelaEsperada(sistema, sd, i, n),
    parcelaInformada: taxa.parcelaCheia,
    parcelasRestantes: n,
    taxaMensal: i,
    taxa: taxa,
    patrimonioLiquido: (Number(valorMercado) || 0) - sd,
  };
}

// Antecipação: o mesmo dinheiro extra abatido de duas formas diferentes.
//   PRAZO   — mantém a parcela e encurta o contrato. Economiza mais juros.
//   PARCELA — mantém o prazo e alivia o mês. Economiza menos.
// Devolve os dois lado a lado porque a escolha depende do fôlego de caixa, não
// só do total economizado.
function finSimularAmortizacao(fin, valorExtra) {
  fin = fin || {};
  var sistema = fin.sistema === 'price' ? 'price' : 'sac';
  var sd = Number(fin.saldoDevedor) || 0;
  var i = Number(fin.taxaMensal) || 0;
  var n = Math.max(0, Math.round(Number(fin.parcelasRestantes) || 0));
  var extra = Math.max(0, Number(valorExtra) || 0);
  if (sd <= 0 || n <= 0) return null;

  var jurosAtuais = finJurosRestantes(sistema, sd, i, n);
  var novoSaldo = Math.max(0, sd - extra);

  // Quitação total: não sobra prazo nem juros.
  if (novoSaldo === 0) {
    return {
      quitou: true,
      valorExtra: extra,
      jurosAtuais: jurosAtuais,
      prazo: { parcelas: 0, juros: 0, economia: jurosAtuais, parcelasReduzidas: n },
      parcela: { parcelas: 0, juros: 0, economia: jurosAtuais, novaParcela: 0 },
    };
  }

  // --- Reduzir PRAZO: mantém o ritmo de pagamento e encurta o contrato ---
  var nPrazo;
  if (sistema === 'price') {
    var pmt = finParcelaPrice(sd, i, n);
    if (i <= 0) nPrazo = Math.ceil(novoSaldo / pmt);
    else {
      // n' = −ln(1 − SD'·i/PMT) / ln(1+i)
      var base = 1 - (novoSaldo * i) / pmt;
      nPrazo = base <= 0 ? n : Math.ceil(-Math.log(base) / Math.log(1 + i));
    }
  } else {
    // SAC mantém a amortização mensal; o prazo cai na proporção do saldo.
    nPrazo = Math.ceil(novoSaldo / (sd / n));
  }
  nPrazo = Math.max(1, Math.min(n, nPrazo));
  var jurosPrazo = finJurosRestantes(sistema, novoSaldo, i, nPrazo);

  // --- Reduzir PARCELA: mantém o prazo e diminui o valor mensal ---
  var jurosParcela = finJurosRestantes(sistema, novoSaldo, i, n);
  var novaParcela = finParcelaEsperada(sistema, novoSaldo, i, n);

  return {
    quitou: false,
    valorExtra: extra,
    jurosAtuais: jurosAtuais,
    prazo: {
      parcelas: nPrazo,
      parcelasReduzidas: n - nPrazo,
      juros: jurosPrazo,
      economia: Math.max(0, jurosAtuais - jurosPrazo),
    },
    parcela: {
      parcelas: n,
      novaParcela: novaParcela,
      juros: jurosParcela,
      economia: Math.max(0, jurosAtuais - jurosParcela),
    },
  };
}

// Soma das dívidas de todos os bens ativos. Os KPIs de patrimônio seguem com o
// valor CHEIO dos bens (decisão de produto); esta soma alimenta o indicador
// separado de dívida.
function totalDividaBens() {
  return bensAtivos().reduce(function (soma, b) {
    var f = b.financiamento;
    return soma + (f && f.ativo ? Number(f.saldoDevedor) || 0 : 0);
  }, 0);
}

// ============================================================
// === CEP e estimativa por m² (imóveis)                     ===
// ============================================================

function bemMascaraCep(input) {
  var d = String(input.value || '')
    .replace(/\D/g, '')
    .slice(0, 8);
  input.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}

function _cepLimpo(v) {
  return String(v || '').replace(/\D/g, '');
}

function _mostrarEnderecoBem(html, erro) {
  var box = document.getElementById('bemEnderecoInfo');
  if (!box) return;
  if (!html) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  box.style.background = erro ? 'var(--cor-bg-amber)' : 'var(--cor-bg-info)';
  box.style.borderColor = erro ? 'var(--cor-borda-amber)' : 'var(--cor-borda-info)';
  box.style.color = erro ? 'var(--cor-txt-amber)' : 'var(--cor-txt-info)';
  box.innerHTML = html;
}

// Preenche o endereço a partir do CEP. Nunca bloqueia o cadastro: se as duas
// APIs falharem (offline, fora do ar), avisa e deixa o usuário seguir.
function buscarCepBem() {
  var input = document.getElementById('bemCep');
  if (!input) return;
  var cep = _cepLimpo(input.value);
  if (!cep) return _mostrarEnderecoBem('');
  if (cep.length !== 8) {
    return _mostrarEnderecoBem('<i class="ph ph-warning"></i> CEP incompleto.', true);
  }
  if (_cepCache[cep]) return _aplicarEnderecoBem(_cepCache[cep]);

  _mostrarEnderecoBem('<i class="ph ph-circle-notch"></i> Buscando endereço…');
  var i = 0;
  function tentar() {
    if (i >= CEP_ENDPOINTS.length) {
      return _mostrarEnderecoBem(
        '<i class="ph ph-warning"></i> Não consegui consultar o CEP agora. Você pode preencher o endereço na descrição e seguir.',
        true
      );
    }
    var ep = CEP_ENDPOINTS[i++];
    fetch(ep.url(cep))
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        var end = d ? ep.parse(d) : null;
        if (!end) return tentar();
        _cepCache[cep] = end;
        _aplicarEnderecoBem(end);
      })
      .catch(function () {
        tentar();
      });
  }
  tentar();
}

function _aplicarEnderecoBem(end) {
  var partes = [end.logradouro, end.bairro].filter(Boolean).join(', ');
  var cidade = [end.cidade, end.uf].filter(Boolean).join('/');
  _mostrarEnderecoBem(
    '<i class="ph-fill ph-map-pin"></i> ' +
      (partes ? '<strong>' + partes + '</strong><br>' : '') +
      cidade
  );
}

function _enderecoAtualBem() {
  var cep = _cepLimpo((document.getElementById('bemCep') || {}).value);
  return cep && _cepCache[cep] ? _cepCache[cep] : null;
}

// Compara o valor cadastrado com área × referência de R$/m². Não substitui o
// valor: só mostra a diferença, para o usuário decidir.
function bemEstimarPorM2() {
  var box = document.getElementById('bemEstimativaM2');
  if (!box) return;
  var area = parseFloat(
    String((document.getElementById('bemAreaM2') || {}).value || '').replace(',', '.')
  );
  var refM2 =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('bemValorM2') || {}).value)
      : 0;
  if (!area || area <= 0 || !refM2 || refM2 <= 0) {
    box.style.display = 'none';
    return;
  }
  var estimado = area * refM2;
  var fmt =
    typeof formatarMoeda === 'function'
      ? formatarMoeda
      : function (v) {
          return 'R$ ' + v.toFixed(2);
        };
  var atual =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('bemValorAtual') || {}).value)
      : 0;

  var linhaComparacao = '';
  if (atual > 0) {
    var dif = ((atual - estimado) / estimado) * 100;
    var acima = dif >= 0;
    linhaComparacao =
      '<br>O valor que você cadastrou (' +
      fmt(atual) +
      ') está <strong>' +
      Math.abs(dif).toFixed(0) +
      '% ' +
      (acima ? 'acima' : 'abaixo') +
      '</strong> dessa referência.';
  }
  box.style.display = '';
  box.style.background = 'var(--cor-bg-primaria)';
  box.style.border = '1px solid var(--cor-borda-primaria)';
  box.style.color = 'var(--cor-txt-primaria)';
  box.innerHTML =
    '<i class="ph ph-calculator"></i> ' +
    area.toLocaleString('pt-BR') +
    ' m² × ' +
    fmt(refM2) +
    '/m² = <strong>' +
    fmt(estimado) +
    '</strong>' +
    linhaComparacao;
}

// ============================================================
// === MODAL EM PASSOS                                       ===
// ============================================================

function bemOnTrocarTipo() {
  var tipo = (document.getElementById('bemTipo') || {}).value;
  var imovel = document.getElementById('bemImovelWrap');
  if (imovel) imovel.style.display = tipo === 'imovel' ? '' : 'none';
  bemToggleFipe();
  bemLimparFipe();
}

function resetarPassosBem() {
  var p1 = document.getElementById('bemPasso1');
  var p2 = document.getElementById('bemPasso2');
  var p3 = document.getElementById('bemPasso3');
  var a1 = document.getElementById('bemAcoesPasso1');
  var a2 = document.getElementById('bemAcoesPasso2');
  var a3 = document.getElementById('bemAcoesPasso3');
  if (p1) p1.style.display = '';
  if (p2) p2.style.display = 'none';
  if (p3) {
    p3.style.display = 'none';
    p3.innerHTML = '';
  }
  if (a1) a1.style.display = 'flex';
  if (a2) a2.style.display = 'none';
  if (a3) a3.style.display = 'none';
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
}

function irParaValoresBem() {
  var nome = ((document.getElementById('bemNome') || {}).value || '').trim();
  if (!nome) return mostrarToast('Informe o nome do bem.', 'erro');
  document.getElementById('bemPasso1').style.display = 'none';
  document.getElementById('bemAcoesPasso1').style.display = 'none';
  document.getElementById('bemPasso2').style.display = '';
  document.getElementById('bemAcoesPasso2').style.display = 'flex';
  bemMarcarPasso(3);
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
  // A comparação por m² usa o valor atual, que só existe neste passo.
  bemEstimarPorM2();
}

function voltarParaDadosBem() {
  document.getElementById('bemPasso2').style.display = 'none';
  document.getElementById('bemAcoesPasso2').style.display = 'none';
  document.getElementById('bemPasso1').style.display = '';
  document.getElementById('bemAcoesPasso1').style.display = 'flex';
  bemMarcarPasso(2);
}

function bemToggleFinanciamento() {
  var on = !!(document.getElementById('bemFinanciado') || {}).checked;
  var wrap = document.getElementById('bemFinanciamentoWrap');
  if (wrap) wrap.style.display = on ? '' : 'none';
  var btn = document.getElementById('btnSalvarBem');
  if (btn) {
    btn.innerHTML = on
      ? 'Ver o custo real <i class="ph-bold ph-arrow-right"></i>'
      : '<i class="ph ph-check"></i> Salvar bem';
  }
}

// Lê os campos de financiamento do formulário. Devolve null quando o toggle
// está desligado — é o que apaga o bloco de um bem que foi quitado.
function lerFinanciamentoDoForm() {
  if (!(document.getElementById('bemFinanciado') || {}).checked) return null;
  var brl = function (id) {
    return typeof parseBRL === 'function' ? parseBRL((document.getElementById(id) || {}).value) : 0;
  };
  var taxaTxt = String((document.getElementById('bemFinTaxa') || {}).value || '').replace(',', '.');
  var taxaPct = parseFloat(taxaTxt);
  var bruto = {
    ativo: true,
    sistema: (document.getElementById('bemFinSistema') || {}).value === 'price' ? 'price' : 'sac',
    valorFinanciado: brl('bemFinValorFinanciado'),
    valorPago: brl('bemFinValorPago'),
    saldoDevedor: brl('bemFinSaldoDevedor'),
    valorParcela: brl('bemFinParcela'),
    segurosTarifas: brl('bemFinSeguros'),
    // Guardado como fração ao mês (0,8% → 0.008): é a unidade que as funções
    // de cálculo esperam, e converter uma vez só evita erro de fator 100.
    // Campo opcional — 0 significa "não sei, deduza da minha parcela".
    taxaInformada: isFinite(taxaPct) && taxaPct > 0 ? taxaPct / 100 : 0,
    parcelasRestantes:
      parseInt((document.getElementById('bemFinParcelasRestantes') || {}).value, 10) || 0,
    fonteVerdade:
      (document.getElementById('bemFinFonteVerdade') || {}).value === 'taxa' ? 'taxa' : 'parcela',
    // Todo bem financiado passa pela análise antes de salvar, então gravar este
    // campo equivale a "a pessoa viu as duas opções". A ausência dele marca os
    // registros anteriores à mudança, os únicos que o card ainda cutuca.
  };
  // `taxaMensal` é a taxa RESOLVIDA — a que os cálculos usam e a que fica
  // gravada. Quem lê o bem depois (simulador de antecipação, lista) encontra
  // um número pronto e não precisa saber que ele pode ter sido deduzido.
  var resolvida = finResolverTaxa(bruto);
  bruto.taxaMensal = resolvida.taxaMensal;
  bruto.taxaOrigem = resolvida.origem;
  return bruto;
}

function preencherFinanciamentoNoForm(fin) {
  var chk = document.getElementById('bemFinanciado');
  var sel = document.getElementById('bemFinSistema');
  if (sel) {
    sel.innerHTML = FIN_SISTEMAS.map(function (t) {
      return '<option value="' + t.v + '">' + t.label + '</option>';
    }).join('');
  }
  if (chk) chk.checked = !!(fin && fin.ativo);
  if (fin && fin.ativo) {
    if (sel) sel.value = fin.sistema === 'price' ? 'price' : 'sac';
    if (typeof setValorBRLInput === 'function') {
      setValorBRLInput(document.getElementById('bemFinValorFinanciado'), fin.valorFinanciado || 0);
      setValorBRLInput(document.getElementById('bemFinValorPago'), fin.valorPago || 0);
      setValorBRLInput(document.getElementById('bemFinSaldoDevedor'), fin.saldoDevedor || 0);
      setValorBRLInput(document.getElementById('bemFinParcela'), fin.valorParcela || 0);
      // Opcional e vazio ≠ opcional respondido com zero.
      setValorBRLInput(
        document.getElementById('bemFinSeguros'),
        fin.segurosTarifas > 0 ? fin.segurosTarifas : ''
      );
    }
    // Só volta ao campo o que a pessoa digitou. Taxa deduzida da parcela fica
    // em branco: ela é resultado, não dado de entrada — senão a dedução de uma
    // sessão vira "informado pelo usuário" na seguinte e o conflito some.
    var elTaxa = document.getElementById('bemFinTaxa');
    if (elTaxa) {
      var digitada =
        fin.taxaInformada !== undefined && fin.taxaInformada !== null
          ? Number(fin.taxaInformada)
          : fin.taxaOrigem === 'derivada'
            ? 0
            : Number(fin.taxaMensal) || 0;
      elTaxa.value = digitada > 0 ? _fmtTaxaNumero(digitada) : '';
    }
    var elFonte = document.getElementById('bemFinFonteVerdade');
    if (elFonte) elFonte.value = fin.fonteVerdade === 'taxa' ? 'taxa' : 'parcela';
    var elParc = document.getElementById('bemFinParcelasRestantes');
    if (elParc) elParc.value = fin.parcelasRestantes || '';
  } else {
    [
      'bemFinValorFinanciado',
      'bemFinValorPago',
      'bemFinSaldoDevedor',
      'bemFinParcela',
      'bemFinSeguros',
      'bemFinTaxa',
      'bemFinParcelasRestantes',
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var elFonte0 = document.getElementById('bemFinFonteVerdade');
    if (elFonte0) elFonte0.value = 'parcela';
  }
  bemToggleFinanciamento();
}

// Passo 2 → salvar direto (à vista) ou seguir para a análise (financiado).
function avancarDoPasso2Bem() {
  var fin = lerFinanciamentoDoForm();
  if (!fin) return salvarFormBem();
  if (!(fin.saldoDevedor > 0)) return mostrarToast('Informe quanto ainda falta pagar.', 'erro');
  if (!(fin.parcelasRestantes > 0)) return mostrarToast('Informe quantas parcelas faltam.', 'erro');
  // Taxa OU parcela: com uma das duas a conta fecha. Exigir as duas era pedir
  // que a pessoa achasse no contrato um número que a parcela já entrega.
  if (!(fin.valorParcela > 0) && !(fin.taxaInformada > 0))
    return mostrarToast('Informe o valor da parcela ou a taxa de juros.', 'erro');
  // O resto (parcela que não fecha, saldo com cara de total a pagar) não trava
  // o caminho: a análise explica e oferece a correção com o contexto na tela.

  document.getElementById('bemPasso2').style.display = 'none';
  document.getElementById('bemAcoesPasso2').style.display = 'none';
  document.getElementById('bemPasso3').style.display = '';
  document.getElementById('bemAcoesPasso3').style.display = 'flex';
  renderAnaliseFinanciamento();
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
}

// Abre um bem já cadastrado direto na análise. Sem isso, rever o custo de um
// financiamento custa três telas de formulário que a pessoa não quer mexer —
// e quem tem um registro antigo com a taxa torta nunca ia chegar lá.
function abrirAnaliseBem(id) {
  var b = obterBem(id);
  if (!b || !b.financiamento || !b.financiamento.ativo) return;
  editarBemForm(id);
  ['bemPasso1', 'bemPasso2', 'bemAcoesPasso1', 'bemAcoesPasso2'].forEach(function (i) {
    var el = document.getElementById(i);
    if (el) el.style.display = 'none';
  });
  document.getElementById('bemPasso3').style.display = '';
  document.getElementById('bemAcoesPasso3').style.display = 'flex';
  renderAnaliseFinanciamento();
  var card = document.querySelector('#modalBem > div');
  if (card) card.scrollTop = 0;
}

function voltarParaValoresBem() {
  document.getElementById('bemPasso3').style.display = 'none';
  document.getElementById('bemAcoesPasso3').style.display = 'none';
  document.getElementById('bemPasso2').style.display = '';
  document.getElementById('bemAcoesPasso2').style.display = 'flex';
}

// Uma linha do resumo. `hint` é a tradução do termo em miúdos, logo abaixo do
// rótulo — é o que dispensa a pessoa de saber o que é "saldo devedor".
function _linhaResumoFin(rotulo, valor, cor, forte, hint) {
  var fmt =
    typeof formatarMoeda === 'function'
      ? formatarMoeda
      : function (v) {
          return 'R$ ' + v.toFixed(2);
        };
  return (
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;padding:5px 0;">' +
    '<span style="color:var(--cor-texto-secundario);">' +
    rotulo +
    (hint
      ? '<span style="display:block;font-size:10.5px;color:var(--cor-texto-mutado);line-height:1.4;margin-top:1px;">' +
        hint +
        '</span>'
      : '') +
    '</span>' +
    "<strong style=\"font-family:'DM Mono',monospace;white-space:nowrap;" +
    (forte ? 'font-size:14px;' : '') +
    (cor ? 'color:' + cor + ';' : '') +
    '">' +
    fmt(valor) +
    '</strong></div>'
  );
}

function _tituloBlocoFin(txt) {
  return (
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--cor-texto-mutado);margin-bottom:6px;">' +
    txt +
    '</div>'
  );
}

// Taxa em % com casas suficientes para não virar 0,00 em juros baixos, e sem
// zero à direita: 7,30% lido em voz alta soa errado; 7,3% é como a pessoa fala.
function _fmtTaxaNumero(fracao) {
  var pct = (Number(fracao) || 0) * 100;
  var txt = pct.toFixed(pct < 0.1 ? 3 : 2);
  if (txt.indexOf('.') >= 0) txt = txt.replace(/0+$/, '').replace(/\.$/, '');
  return txt.replace('.', ',');
}

function _fmtTaxaMensal(fracao) {
  return _fmtTaxaNumero(fracao) + '% ao mês';
}

// A mesma taxa em ano — é assim que se compara com poupança, CDI ou com a taxa
// que o banco anuncia na vitrine.
function _fmtTaxaAnual(fracao) {
  return _fmtTaxaNumero(Math.pow(1 + (Number(fracao) || 0), 12) - 1) + '% ao ano';
}

function _caixaAvisoFin(corpo, tom) {
  var cores =
    tom === 'info'
      ? 'background:var(--cor-bg-primaria);border:1px solid var(--cor-borda-primaria);color:var(--cor-txt-primaria);'
      : 'background:var(--cor-bg-amber);border:1px solid var(--cor-borda-amber);color:var(--cor-txt-amber);';
  return (
    '<div style="' +
    cores +
    'border-radius:9px;padding:11px 13px;font-size:11.5px;line-height:1.55;">' +
    corpo +
    '</div>'
  );
}

function _botaoAvisoFin(onclick, rotulo, ativo) {
  return (
    '<button type="button" onclick="' +
    onclick +
    '" style="display:block;width:100%;text-align:left;margin-top:6px;padding:8px 11px;font-size:11.5px;border-radius:8px;cursor:pointer;font-family:inherit;line-height:1.45;' +
    (ativo
      ? 'border:1.5px solid currentColor;background:rgba(255,255,255,0.55);font-weight:700;'
      : 'border:1px solid var(--cor-borda);background:transparent;color:inherit;opacity:0.75;') +
    '">' +
    (ativo ? '<i class="ph-fill ph-check-circle"></i> ' : '') +
    rotulo +
    '</button>'
  );
}

// Em quem acreditar quando parcela e taxa se contradizem. A escolha fica no
// formulário (input escondido) para sobreviver ao salvar e à reabertura.
function bemEscolherFonteVerdade(fonte) {
  var el = document.getElementById('bemFinFonteVerdade');
  if (!el) return;
  el.value = fonte === 'taxa' ? 'taxa' : 'parcela';
  renderAnaliseFinanciamento();
}

// Saldo com cara de "total a pagar". Erro caro: infla a dívida e some com os
// juros, porque parcela × prazo já é o total com juros embutidos.
function _avisoSaldoFin(r) {
  var fmt = _fmtDinheiroFin();
  return _caixaAvisoFin(
    '<div style="font-weight:700;margin-bottom:4px;"><i class="ph-fill ph-warning"></i> Confira quanto você ainda deve</div>' +
      'Os <strong>' +
      fmt(r.saldoDevedor) +
      '</strong> que você informou são quase exatamente ' +
      r.parcelasRestantes +
      ' × ' +
      fmt(r.taxa.parcelaCheia) +
      ' — ou seja, o <strong>total que falta pagar</strong>, com os juros já embutidos. ' +
      'Aqui vai o <strong>saldo devedor de hoje</strong>: o valor para quitar tudo agora, que o app do banco mostra logo acima do total. Ele é bem menor.' +
      '<div style="margin-top:6px;">Se o seu financiamento é mesmo sem juros, então está certo — siga em frente.</div>' +
      '<button type="button" onclick="voltarParaValoresBem()" style="margin-top:8px;padding:6px 12px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-family:inherit;">' +
      '<i class="ph-bold ph-arrow-left"></i> Voltar e corrigir</button>'
  );
}

// Parcela e taxa se contradizem: quem manda? A parcela é verificável no
// extrato, a taxa é interpretada do contrato — por isso o padrão é a parcela.
// Mas cada opção mostra a consequência, para a escolha ser por reconhecimento
// ("essa eu sei que é a minha") e não por adivinhação.
function _avisoConflitoFin(r) {
  var fmt = _fmtDinheiroFin();
  var t = r.taxa;
  var explicacao = '';
  if (t.causa === 'anual')
    explicacao = ' Parece que a taxa digitada é a <strong>do ano</strong> — no campo vai a do mês.';
  else if (t.causa === 'decimal') explicacao = ' Parece que faltou uma casa decimal na taxa.';

  return _caixaAvisoFin(
    '<div style="font-weight:700;margin-bottom:4px;"><i class="ph-fill ph-warning"></i> Qual dos dois está certo?</div>' +
      'A parcela de <strong>' +
      fmt(t.parcelaCheia) +
      '</strong> e a taxa de <strong>' +
      _fmtTaxaMensal(t.taxaInformada) +
      '</strong> não combinam.' +
      explicacao +
      ' Só um dos dois pode valer — escolha o que você tem certeza:' +
      _botaoAvisoFin(
        "bemEscolherFonteVerdade('parcela')",
        'A parcela é <strong>' +
          fmt(t.parcelaCheia) +
          '</strong><span style="display:block;font-weight:400;opacity:0.85;">então o seu juro é ' +
          _fmtTaxaMensal(t.taxaImplicita) +
          '</span>',
        t.escolha === 'parcela'
      ) +
      _botaoAvisoFin(
        "bemEscolherFonteVerdade('taxa')",
        'A taxa é <strong>' +
          _fmtTaxaMensal(t.taxaInformada) +
          '</strong><span style="display:block;font-weight:400;opacity:0.85;">então a parcela seria ' +
          fmt(t.parcelaEsperada) +
          '</span>',
        t.escolha === 'taxa'
      ) +
      '<div style="margin-top:8px;font-size:11px;opacity:0.85;">Na dúvida, fique na parcela: ela debita na sua conta todo mês, enquanto o contrato traz várias taxas diferentes.</div>'
  );
}

// Parcela que nenhuma taxa explica: ela é menor que a dívida dividida pelo
// prazo, que é o piso sem juro nenhum. Aqui não há escolha a oferecer — algum
// dos três números está errado e só a pessoa sabe qual.
function _avisoParcelaImpossivelFin(r) {
  var fmt = _fmtDinheiroFin();
  var t = r.taxa;
  return _caixaAvisoFin(
    '<div style="font-weight:700;margin-bottom:4px;"><i class="ph-fill ph-warning"></i> Esses números não se encaixam</div>' +
      'Dividindo ' +
      fmt(r.saldoDevedor) +
      ' por ' +
      r.parcelasRestantes +
      ' parcelas dá ' +
      fmt(r.saldoDevedor / Math.max(1, r.parcelasRestantes)) +
      ' por mês <em>sem juro nenhum</em> — mais que a parcela de <strong>' +
      fmt(t.parcelaCheia) +
      '</strong> que você informou. Confira os três: quanto ainda deve, o valor da parcela e quantas faltam.' +
      '<div style="margin-top:6px;font-size:11px;opacity:0.85;">Por enquanto os números abaixo usam a taxa de ' +
      _fmtTaxaMensal(t.taxaInformada) +
      ' que você digitou.</div>' +
      '<button type="button" onclick="voltarParaValoresBem()" style="margin-top:8px;padding:6px 12px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-family:inherit;">' +
      '<i class="ph-bold ph-arrow-left"></i> Voltar e corrigir</button>'
  );
}

// Taxa deduzida da parcela: não é aviso, é entrega. A maioria das pessoas não
// sabe quanto paga de juros, e agora sabe sem ter procurado no contrato.
function _avisoTaxaDeduzidaFin(r) {
  var t = r.taxa;
  var corpo =
    '<div style="font-weight:700;margin-bottom:4px;"><i class="ph-fill ph-percent"></i> O seu juro é ≈' +
    _fmtTaxaMensal(t.taxaImplicita) +
    '</div>' +
    'Deduzimos da sua parcela, do saldo e do prazo — você não precisou achar no contrato. Dá ≈' +
    _fmtTaxaAnual(t.taxaImplicita) +
    '.';
  if (!(t.segurosTarifas > 0))
    corpo +=
      '<div style="margin-top:6px;">É uma estimativa <strong>por cima</strong>: se a parcela embute seguro (MIP/DFI) ou taxa de administração, parte dela não é juro. Informe esse valor no passo anterior para afinar a conta.</div>' +
      '<button type="button" onclick="voltarParaValoresBem()" style="margin-top:8px;padding:6px 12px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-family:inherit;">' +
      '<i class="ph-bold ph-arrow-left"></i> Informar seguros e tarifas</button>';
  else
    corpo +=
      '<div style="margin-top:6px;">Já descontamos os ' +
      _fmtDinheiroFin()(t.segurosTarifas) +
      ' de seguro e tarifas da parcela antes de calcular.</div>';
  return _caixaAvisoFin(corpo, 'info');
}

function _fmtDinheiroFin() {
  return typeof formatarMoeda === 'function'
    ? formatarMoeda
    : function (v) {
        return 'R$ ' + v.toFixed(2);
      };
}

function renderAnaliseFinanciamento() {
  var box = document.getElementById('bemPasso3');
  if (!box) return;
  var fin = lerFinanciamentoDoForm();
  if (!fin) {
    box.innerHTML = '';
    return;
  }
  var valorMercado =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('bemValorAtual') || {}).value)
      : 0;
  var r = finResumo(fin, valorMercado);
  var fmt = _fmtDinheiroFin();
  var pctJuros = r.totalAPagar > 0 ? (r.jurosRestantes / r.totalAPagar) * 100 : 0;

  // O aviso vem ANTES do número grande: se há dúvida sobre os dados, saber
  // disso é mais importante que o valor — senão a pessoa acredita num juro que
  // não é o dela e sai assustada da tela. Um de cada vez, na ordem do estrago:
  // saldo errado infla tudo; conflito escolhe entre dois mundos; taxa deduzida
  // é só uma boa notícia a dar.
  var aviso = '';
  if (r.taxa.saldoPareceTotal) aviso = _avisoSaldoFin(r);
  else if (r.taxa.conflito && r.taxa.taxaImplicita !== null) aviso = _avisoConflitoFin(r);
  else if (r.taxa.conflito) aviso = _avisoParcelaImpossivelFin(r);
  else if (r.taxa.origem === 'derivada' && r.taxa.taxaImplicita !== null)
    aviso = _avisoTaxaDeduzidaFin(r);

  var comoPaga =
    r.sistema === 'sac'
      ? 'a parcela cai um pouquinho a cada mês (SAC)'
      : 'a parcela é sempre a mesma (Price)';

  // Quanto do bem já é seu: só faz sentido se a pessoa disse quanto ele vale.
  // Sem isso, o cálculo daria um patrimônio negativo do tamanho da dívida —
  // número correto na fórmula e assustador na tela. Melhor pedir o dado.
  var blocoLiquido;
  if (valorMercado > 0) {
    blocoLiquido =
      '<div style="border:1px solid var(--cor-borda-primaria);background:var(--cor-bg-primaria);border-radius:10px;padding:12px 14px;">' +
      _tituloBlocoFin('Quanto do bem já é seu') +
      _linhaResumoFin('O bem vale hoje', valorMercado) +
      _linhaResumoFin('Menos a dívida que falta', -r.saldoDevedor) +
      '<div style="border-top:1px dashed var(--cor-borda-primaria);margin:6px 0 2px;"></div>' +
      _linhaResumoFin(
        'Já é seu',
        r.patrimonioLiquido,
        r.patrimonioLiquido >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)',
        true,
        'o que sobraria se vendesse e quitasse hoje'
      ) +
      '</div>';
  } else {
    blocoLiquido =
      '<div style="border:1px dashed var(--cor-borda);border-radius:10px;padding:12px 14px;font-size:11.5px;color:var(--cor-texto-secundario);line-height:1.55;">' +
      '<i class="ph ph-info" style="color:var(--cor-primaria);"></i> Você ainda não disse <strong>quanto o bem vale hoje</strong>. Preencha o "Valor atual" para ver quanto dele já é seu e quanto ainda é do banco.' +
      '<button type="button" onclick="voltarParaValoresBem()" style="display:block;margin-top:8px;padding:6px 12px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid var(--cor-borda);background:var(--cor-superficie);color:var(--cor-texto-principal);cursor:pointer;font-family:inherit;">' +
      '<i class="ph-bold ph-arrow-left"></i> Voltar e preencher</button>' +
      '</div>';
  }

  box.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:14px;">' +
    aviso +
    '<div style="background:linear-gradient(135deg,var(--cor-patrimonio),#7c3aed);color:#fff;border-radius:12px;padding:16px 18px;">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;opacity:0.85;font-weight:700;">Você ainda vai pagar de juros</div>' +
    '<div style="font-size:28px;font-weight:800;font-family:\'DM Mono\',monospace;letter-spacing:-1px;margin:4px 0 2px;">' +
    fmt(r.jurosRestantes) +
    '</div>' +
    '<div style="font-size:12.5px;opacity:0.92;line-height:1.5;">De cada R$ 100 que ainda saem do seu bolso, <strong>R$ ' +
    pctJuros.toFixed(0) +
    ' são só juros</strong> — o resto abate a dívida.<br>Faltam ' +
    r.parcelasRestantes +
    ' parcelas, ' +
    comoPaga +
    ', a ' +
    _fmtTaxaMensal(r.taxaMensal) +
    '.</div>' +
    '</div>' +
    '<div style="border:1px solid var(--cor-borda);border-radius:10px;padding:12px 14px;">' +
    _tituloBlocoFin('Quanto este bem custa no total') +
    _linhaResumoFin('Você já pagou', r.valorPago, null, false, 'o que já saiu do bolso até hoje') +
    _linhaResumoFin(
      'Ainda deve ao banco',
      r.saldoDevedor,
      null,
      false,
      'é o que o banco chama de saldo devedor'
    ) +
    _linhaResumoFin(
      'Juros até a última parcela',
      r.jurosRestantes,
      'var(--cor-erro)',
      false,
      'o que você paga a mais por ter parcelado'
    ) +
    '<div style="border-top:1px dashed var(--cor-borda);margin:6px 0 2px;"></div>' +
    _linhaResumoFin('No fim, o bem terá custado', r.custoTotal, null, true) +
    '</div>' +
    blocoLiquido +
    '<div style="font-size:11.5px;color:var(--cor-texto-mutado);line-height:1.5;">' +
    '<i class="ph ph-info"></i> Depois de salvar, use <strong>Antecipar parcelas</strong> no card do bem para ver quanto você economiza pagando um valor extra.' +
    '</div>' +
    '</div>';
}

// ============================================================
// === SIMULADOR DE AMORTIZAÇÃO                              ===
// ============================================================

function abrirModalAmortizacao(id) {
  var b = obterBem(id);
  if (!b || !b.financiamento || !b.financiamento.ativo) return;
  document.getElementById('amortizacaoBemId').value = id;
  document.getElementById('tituloModalAmortizacao').textContent = 'Antecipar — ' + b.nome;
  document.getElementById('amortizacaoValor').value = '';
  document.getElementById('amortizacaoResultado').innerHTML = '';
  var m = document.getElementById('modalAmortizacao');
  if (m) m.style.display = 'flex';
  document.getElementById('amortizacaoValor').focus();
}

function fecharModalAmortizacao() {
  var m = document.getElementById('modalAmortizacao');
  if (m) m.style.display = 'none';
}

function renderSimulacaoAmortizacao() {
  var box = document.getElementById('amortizacaoResultado');
  if (!box) return;
  var b = obterBem((document.getElementById('amortizacaoBemId') || {}).value);
  if (!b || !b.financiamento) return;
  var extra =
    typeof parseBRL === 'function'
      ? parseBRL((document.getElementById('amortizacaoValor') || {}).value)
      : 0;
  if (!(extra > 0)) {
    box.innerHTML = '';
    return;
  }
  var sim = finSimularAmortizacao(b.financiamento, extra);
  if (!sim) {
    box.innerHTML = '';
    return;
  }
  var fmt = _fmtDinheiroFin();

  // Toda a economia simulada aqui sai da taxa gravada. Se ela não bate com a
  // parcela e ninguém foi perguntado, o número abaixo é promessa em cima de
  // erro de digitação — e é grande o bastante para a pessoa tomar decisão.
  var alerta = '';
  if (finConflitoNaoRevisado(b.financiamento)) {
    var t = finResolverTaxa(b.financiamento);
    alerta =
      _caixaAvisoFin(
        '<i class="ph-fill ph-warning"></i> Estes números usam a taxa de <strong>' +
          _fmtTaxaMensal(t.taxaInformada) +
          '</strong> que está cadastrada — mas a sua parcela de <strong>' +
          fmt(t.parcelaCheia) +
          '</strong> indica <strong>' +
          _fmtTaxaMensal(t.taxaImplicita) +
          '</strong>. Confira antes de decidir com base na economia abaixo.' +
          '<button type="button" onclick="fecharModalAmortizacao();abrirAnaliseBem(\'' +
          b.id +
          '\')" style="display:block;margin-top:8px;padding:6px 12px;font-size:11.5px;font-weight:600;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;font-family:inherit;">' +
          '<i class="ph-bold ph-arrow-right"></i> Rever a taxa deste bem</button>'
      ) + '<div style="height:12px;"></div>';
  }

  if (sim.quitou) {
    box.innerHTML =
      alerta +
      '<div style="background:linear-gradient(135deg,var(--cor-primaria),#7c3aed);color:#fff;border-radius:12px;padding:16px 18px;">' +
      '<div style="font-size:18px;font-weight:800;">Quita o financiamento</div>' +
      '<div style="font-size:12.5px;opacity:0.92;margin-top:6px;line-height:1.5;">Esse valor cobre todo o saldo devedor. Você deixa de pagar <strong>' +
      fmt(sim.jurosAtuais) +
      '</strong> em juros.</div></div>';
    return;
  }

  var cartao = function (titulo, sub, economia, detalhe, destaque) {
    return (
      '<div style="flex:1 1 200px;border:1.5px solid ' +
      (destaque ? 'var(--cor-borda-primaria)' : 'var(--cor-borda)') +
      ';background:' +
      (destaque ? 'var(--cor-bg-primaria)' : 'var(--cor-superficie)') +
      ';border-radius:10px;padding:12px 14px;">' +
      '<div style="font-size:12px;font-weight:700;color:var(--cor-texto-principal);">' +
      titulo +
      (destaque
        ? ' <span style="font-size:9px;background:var(--cor-primaria);color:#fff;padding:1px 6px;border-radius:4px;vertical-align:middle;">ECONOMIZA MAIS</span>'
        : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--cor-texto-mutado);margin-bottom:8px;">' +
      sub +
      '</div>' +
      '<div style="font-size:18px;font-weight:800;font-family:\'DM Mono\',monospace;color:var(--cor-primaria);">' +
      fmt(economia) +
      '</div>' +
      '<div style="font-size:11px;color:var(--cor-texto-mutado);">de juros economizados</div>' +
      '<div style="font-size:11.5px;color:var(--cor-texto-secundario);margin-top:8px;line-height:1.5;">' +
      detalhe +
      '</div>' +
      '</div>'
    );
  };

  var diferenca = sim.prazo.economia - sim.parcela.economia;
  box.innerHTML =
    alerta +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">' +
    cartao(
      'Reduzir o prazo',
      'A parcela continua igual',
      sim.prazo.economia,
      'O contrato cai de <strong>' +
        (sim.prazo.parcelas + sim.prazo.parcelasReduzidas) +
        '</strong> para <strong>' +
        sim.prazo.parcelas +
        ' parcelas</strong> — ' +
        sim.prazo.parcelasReduzidas +
        ' a menos.',
      true
    ) +
    cartao(
      'Reduzir a parcela',
      'O prazo continua igual',
      sim.parcela.economia,
      'A parcela cai para <strong>' +
        fmt(sim.parcela.novaParcela) +
        '</strong>, mantendo as ' +
        sim.parcela.parcelas +
        ' parcelas.'
    ) +
    '</div>' +
    '<div style="background:var(--cor-superficie);border:1px solid var(--cor-borda);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--cor-texto-secundario);line-height:1.6;">' +
    '<strong style="color:var(--cor-texto-principal);">Qual escolher?</strong><br>' +
    'Reduzir o prazo economiza <strong>' +
    fmt(diferenca) +
    '</strong> a mais em juros — é a melhor conta. ' +
    'Reduzir a parcela economiza menos, mas alivia <strong>' +
    fmt(
      Math.max(
        0,
        finParcelaEsperada(
          b.financiamento.sistema,
          b.financiamento.saldoDevedor,
          b.financiamento.taxaMensal,
          b.financiamento.parcelasRestantes
        ) - sim.parcela.novaParcela
      )
    ) +
    '</strong> por mês no seu orçamento. Se o mês está apertado, o alívio pode valer mais que a economia.' +
    '</div>';
}

function fecharModalBem() {
  var m = document.getElementById('modalBem');
  if (m) m.style.display = 'none';
}

function abrirNovoBemForm() {
  var modal = document.getElementById('modalBem');
  if (!modal) return;
  document.getElementById('bemEditId').value = '';
  document.getElementById('tituloModalBem').querySelector('span').textContent = 'Novo bem';
  document.getElementById('bemNome').value = '';
  document.getElementById('bemDescricao').value = '';
  var selTipo = document.getElementById('bemTipo');
  selTipo.innerHTML = BEM_TIPOS.map(function (t) {
    return '<option value="' + t.v + '">' + t.label + '</option>';
  }).join('');
  selTipo.value = 'veiculo';
  var selImovel = document.getElementById('bemImovelTipo');
  if (selImovel) {
    selImovel.innerHTML = BEM_IMOVEL_TIPOS.map(function (t) {
      return '<option value="' + t.v + '">' + t.label + '</option>';
    }).join('');
    selImovel.value = 'apartamento';
  }
  ['bemCep', 'bemAreaM2', 'bemValorM2', 'bemValorAtual', 'bemValorCompra'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _mostrarEnderecoBem('');
  var est = document.getElementById('bemEstimativaM2');
  if (est) est.style.display = 'none';
  preencherFinanciamentoNoForm(null);
  document.getElementById('bemDataCompra').value = new Date().toISOString().slice(0, 10);
  bemOnTrocarTipo();
  resetarPassosBem();
  var busca = document.getElementById('bemFipeBusca');
  if (busca) busca.value = '';
  var res = document.getElementById('bemFipeResultados');
  if (res) res.innerHTML = '';
  // Bem novo começa pelo tipo (passo 1); a edição pula direto para os dados.
  bemMostrarPasso0(true);
  modal.style.display = 'flex';
}

function editarBemForm(id) {
  var b = obterBem(id);
  if (!b) return;
  abrirNovoBemForm();
  document.getElementById('bemEditId').value = id;
  bemMostrarPasso0(false);
  document.getElementById('tituloModalBem').querySelector('span').textContent = 'Editar bem';
  document.getElementById('bemNome').value = b.nome;
  document.getElementById('bemDescricao').value = b.descricao || '';
  document.getElementById('bemTipo').value = b.tipo;
  if (typeof setValorBRLInput === 'function') {
    setValorBRLInput(document.getElementById('bemValorAtual'), b.valorAtual);
    setValorBRLInput(document.getElementById('bemValorCompra'), b.valorCompra);
  }
  document.getElementById('bemDataCompra').value = b.dataCompra || '';
  bemOnTrocarTipo();
  if (b.imovel) {
    var elCep = document.getElementById('bemCep');
    if (elCep) {
      elCep.value = b.imovel.cep || '';
      bemMascaraCep(elCep);
    }
    var elArea = document.getElementById('bemAreaM2');
    if (elArea) elArea.value = b.imovel.areaM2 || '';
    var elTipoImovel = document.getElementById('bemImovelTipo');
    if (elTipoImovel && b.imovel.tipoImovel) elTipoImovel.value = b.imovel.tipoImovel;
    if (typeof setValorBRLInput === 'function' && b.imovel.valorM2) {
      setValorBRLInput(document.getElementById('bemValorM2'), b.imovel.valorM2);
    }
    // Endereço já resolvido antes: mostra sem gastar outra chamada de API.
    if (b.imovel.endereco) {
      var cepLimpo = _cepLimpo(b.imovel.cep);
      if (cepLimpo) _cepCache[cepLimpo] = b.imovel.endereco;
      _aplicarEnderecoBem(b.imovel.endereco);
    }
    bemEstimarPorM2();
  }
  preencherFinanciamentoNoForm(b.financiamento);
  bemToggleFipe();
  if (b.fipe) {
    var info = document.getElementById('bemFipeInfo');
    if (info) {
      info.style.display = '';
      info.innerHTML =
        '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
        '<strong>' +
        (b.fipe.modelo || '') +
        '</strong> — FIPE ' +
        (b.fipe.codigoFipe || '') +
        ' — Ref. ' +
        (b.fipe.mesReferencia || '');
    }
  }
}

function cancelarFormBem() {
  fecharModalBem();
}

function salvarFormBem() {
  var nome = (document.getElementById('bemNome').value || '').trim();
  if (!nome) return mostrarToast('Informe o nome do bem.', 'erro');
  var tipo = document.getElementById('bemTipo').value;
  var valorAtual =
    typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorAtual').value) : 0;
  var valorCompra =
    typeof parseBRL === 'function' ? parseBRL(document.getElementById('bemValorCompra').value) : 0;
  var dataCompra = document.getElementById('bemDataCompra').value || null;
  var descricao = (document.getElementById('bemDescricao').value || '').trim();

  var fipeData = null;
  var fipeInfo = document.getElementById('bemFipeInfo');
  if (fipeInfo && fipeInfo.dataset.fipe) {
    try {
      fipeData = JSON.parse(fipeInfo.dataset.fipe);
    } catch (e) {}
  }

  // Dados de imóvel só existem para imóvel — trocar o tipo descarta o bloco em
  // vez de deixar CEP/área pendurados num veículo.
  var imovelData = null;
  if (tipo === 'imovel') {
    var cep = _cepLimpo((document.getElementById('bemCep') || {}).value);
    var area = parseFloat(
      String((document.getElementById('bemAreaM2') || {}).value || '').replace(',', '.')
    );
    var valorM2 =
      typeof parseBRL === 'function'
        ? parseBRL((document.getElementById('bemValorM2') || {}).value)
        : 0;
    var tipoImovel = (document.getElementById('bemImovelTipo') || {}).value || null;
    if (cep || area > 0 || valorM2 > 0 || tipoImovel) {
      imovelData = {
        cep: cep || null,
        areaM2: area > 0 ? area : null,
        tipoImovel: tipoImovel,
        valorM2: valorM2 > 0 ? valorM2 : null,
        endereco: _enderecoAtualBem(),
      };
    }
  }

  var finData = lerFinanciamentoDoForm();

  var editId = document.getElementById('bemEditId').value;
  if (editId) {
    editarBem(editId, {
      nome: nome,
      tipo: tipo,
      valorAtual: valorAtual,
      valorCompra: valorCompra,
      dataCompra: dataCompra,
      descricao: descricao,
      fipe: fipeData,
      imovel: imovelData,
      financiamento: finData,
    });
    mostrarToast('Bem atualizado.', 'sucesso');
  } else {
    criarBem({
      nome: nome,
      tipo: tipo,
      valorAtual: valorAtual,
      valorCompra: valorCompra,
      dataCompra: dataCompra,
      descricao: descricao,
      fipe: fipeData,
      imovel: imovelData,
      financiamento: finData,
    });
    mostrarToast('Bem cadastrado.', 'sucesso');
  }
  cancelarFormBem();
  renderMeusBens();
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
}

function confirmarExcluirBem(id) {
  var b = obterBem(id);
  if (!b) return;
  var modal = document.getElementById('modalConfirmacao');
  if (!modal) return;
  document.getElementById('modalTitulo').innerHTML =
    '<i class="ph ph-trash" style="color:var(--cor-erro);"></i> Excluir bem';
  document.getElementById('modalMensagem').innerHTML =
    'Excluir <strong>' + b.nome + '</strong>? Essa ação não pode ser desfeita.';
  document.getElementById('modalAcoes').innerHTML =
    '<button class="btn-acao" style="background-color:var(--cor-erro);" onclick="executarExcluirBem(\'' +
    id +
    '\')"><i class="ph ph-trash"></i> Sim, excluir</button>';
  modal.style.display = 'flex';
}

function executarExcluirBem(id) {
  excluirBem(id);
  fecharModal();
  renderMeusBens();
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
  mostrarToast('Bem excluído.', 'sucesso');
}

// ============================================================
// === UI — FIPE (cascata: tipo → marca → modelo → ano)      ===
// ============================================================

function bemToggleFipe() {
  var tipo = document.getElementById('bemTipo').value;
  var wrap = document.getElementById('bemFipeWrap');
  if (wrap) wrap.style.display = tipo === 'veiculo' ? '' : 'none';
}

function bemLimparFipe() {
  var ids = ['bemFipeVeiculoTipo', 'bemFipeMarca', 'bemFipeModelo', 'bemFipeAno'];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  var tipo = document.getElementById('bemFipeVeiculoTipo');
  if (tipo) {
    tipo.innerHTML =
      '<option value="">— tipo de veículo —</option>' +
      BEM_VEICULO_TIPOS.map(function (t) {
        return '<option value="' + t.v + '">' + t.label + '</option>';
      }).join('');
    tipo.disabled = false;
  }
  var info = document.getElementById('bemFipeInfo');
  if (info) {
    info.style.display = 'none';
    info.innerHTML = '';
    info.dataset.fipe = '';
  }
}

function bemFipeOnTipoVeiculo() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marca = document.getElementById('bemFipeMarca');
  var modelo = document.getElementById('bemFipeModelo');
  var ano = document.getElementById('bemFipeAno');
  [marca, modelo, ano].forEach(function (el) {
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  if (!tipoV) return;
  marca.innerHTML = '<option value="">Carregando…</option>';
  marca.disabled = true;
  fipeMarcas(tipoV)
    .then(function (list) {
      marca.innerHTML =
        '<option value="">— marca —</option>' +
        list
          .map(function (m) {
            return '<option value="' + m.codigo + '">' + m.nome + '</option>';
          })
          .join('');
      marca.disabled = false;
    })
    .catch(function () {
      marca.innerHTML = '<option value="">Erro ao carregar</option>';
      mostrarToast('Não foi possível carregar marcas da FIPE.', 'erro');
    });
}

function bemFipeOnMarca() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modelo = document.getElementById('bemFipeModelo');
  var ano = document.getElementById('bemFipeAno');
  [modelo, ano].forEach(function (el) {
    if (el) {
      el.innerHTML = '<option value="">— selecione —</option>';
      el.disabled = true;
    }
  });
  if (!marcaC) return;
  modelo.innerHTML = '<option value="">Carregando…</option>';
  modelo.disabled = true;
  fipeModelos(tipoV, marcaC)
    .then(function (data) {
      var list = data.modelos || data;
      modelo.innerHTML =
        '<option value="">— modelo —</option>' +
        list
          .map(function (m) {
            return '<option value="' + m.codigo + '">' + m.nome + '</option>';
          })
          .join('');
      modelo.disabled = false;
    })
    .catch(function () {
      modelo.innerHTML = '<option value="">Erro ao carregar</option>';
      mostrarToast('Não foi possível carregar modelos da FIPE.', 'erro');
    });
}

function bemFipeOnModelo() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modeloC = document.getElementById('bemFipeModelo').value;
  var anoSel = document.getElementById('bemFipeAno');
  anoSel.innerHTML = '<option value="">— selecione —</option>';
  anoSel.disabled = true;
  if (!modeloC) return;
  anoSel.innerHTML = '<option value="">Carregando…</option>';
  fipeAnos(tipoV, marcaC, modeloC)
    .then(function (list) {
      anoSel.innerHTML =
        '<option value="">— ano —</option>' +
        list
          .map(function (a) {
            return '<option value="' + a.codigo + '">' + a.nome + '</option>';
          })
          .join('');
      anoSel.disabled = false;
    })
    .catch(function () {
      anoSel.innerHTML = '<option value="">Erro ao carregar</option>';
      mostrarToast('Não foi possível carregar anos da FIPE.', 'erro');
    });
}

function bemFipeOnAno() {
  var tipoV = document.getElementById('bemFipeVeiculoTipo').value;
  var marcaC = document.getElementById('bemFipeMarca').value;
  var modeloC = document.getElementById('bemFipeModelo').value;
  var anoC = document.getElementById('bemFipeAno').value;
  if (!anoC) return;
  bemFipeAplicar(tipoV, marcaC, modeloC, anoC);
}

/** Consulta o valor de um veículo da FIPE e preenche o bem (valor atual,
 *  nome se vazio e o registro `fipe` que a atualização mensal usa). */
function bemFipeAplicar(tipoV, marcaC, modeloC, anoC) {
  var info = document.getElementById('bemFipeInfo');
  if (info) {
    info.style.display = '';
    info.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Consultando FIPE…';
  }
  fipeValor(tipoV, marcaC, modeloC, anoC)
    .then(function (data) {
      if (info) {
        info.innerHTML =
          '<i class="ph ph-car-simple" style="color:var(--cor-primaria);"></i> ' +
          '<strong>' +
          (data.Modelo || data.modelo || '') +
          '</strong> — ' +
          (data.Valor || data.valor || '') +
          ' <span style="color:var(--cor-texto-mutado);font-size:11px;">(FIPE ' +
          (data.CodigoFipe || data.codigoFipe || '') +
          ' · Ref. ' +
          (data.MesReferencia || data.mesReferencia || '') +
          ')</span>';
        info.dataset.fipe = JSON.stringify({
          codigoFipe: data.CodigoFipe || data.codigoFipe || '',
          modelo: data.Modelo || data.modelo || '',
          marca: data.Marca || data.marca || '',
          valor: data.Valor || data.valor || '',
          mesReferencia: data.MesReferencia || data.mesReferencia || '',
          tipoVeiculo: tipoV,
          marcaCodigo: marcaC,
          modeloCodigo: modeloC,
          anoCodigo: anoC,
        });
      }
      var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
      var inputValor = document.getElementById('bemValorAtual');
      if (inputValor && valorStr) {
        inputValor.value = valorStr;
        if (typeof aplicarMascaraBRL === 'function') aplicarMascaraBRL(inputValor);
      }
      var marcaNome = data.Marca || data.marca || '';
      var modeloNome = data.Modelo || data.modelo || '';
      var inputNome = document.getElementById('bemNome');
      // "Como você chama este bem": o nome curto do modelo ("Civic"), não o
      // nome inteiro da tabela.
      if (inputNome && !inputNome.value.trim()) {
        inputNome.value = String(modeloNome).split(' ')[0] || (marcaNome + ' ' + modeloNome).trim();
      }
    })
    .catch(function () {
      if (info) {
        info.innerHTML =
          '<span style="color:var(--cor-erro);"><i class="ph ph-warning"></i> Erro ao consultar FIPE</span>';
      }
      mostrarToast('Não foi possível consultar o valor FIPE.', 'erro');
    });
}

// ------------------------------------------------------------
// Busca única na FIPE ("civic 2020")
// ------------------------------------------------------------
// A API pública da FIPE não tem busca por texto: anda por marca → modelo →
// ano. A busca acha a marca pelo nome digitado ou pelo modelo (mapa dos mais
// vendidos), filtra os modelos dessa marca pelas outras palavras e, havendo
// ano, já traz o valor das primeiras opções. Os selects continuam embaixo,
// em "Não achei", para o que a busca não cobrir.
var FIPE_MODELO_MARCA = {
  civic: 'honda',
  city: 'honda',
  fit: 'honda',
  hrv: 'honda',
  wrv: 'honda',
  corolla: 'toyota',
  yaris: 'toyota',
  hilux: 'toyota',
  sw4: 'toyota',
  etios: 'toyota',
  rav4: 'toyota',
  onix: 'chevrolet',
  prisma: 'chevrolet',
  cruze: 'chevrolet',
  tracker: 'chevrolet',
  s10: 'chevrolet',
  spin: 'chevrolet',
  cobalt: 'chevrolet',
  celta: 'chevrolet',
  montana: 'chevrolet',
  equinox: 'chevrolet',
  gol: 'volkswagen',
  polo: 'volkswagen',
  virtus: 'volkswagen',
  tcross: 'volkswagen',
  nivus: 'volkswagen',
  saveiro: 'volkswagen',
  fox: 'volkswagen',
  voyage: 'volkswagen',
  jetta: 'volkswagen',
  amarok: 'volkswagen',
  taos: 'volkswagen',
  tera: 'volkswagen',
  hb20: 'hyundai',
  hb20s: 'hyundai',
  creta: 'hyundai',
  tucson: 'hyundai',
  ka: 'ford',
  ecosport: 'ford',
  ranger: 'ford',
  fiesta: 'ford',
  focus: 'ford',
  territory: 'ford',
  uno: 'fiat',
  mobi: 'fiat',
  argo: 'fiat',
  cronos: 'fiat',
  strada: 'fiat',
  toro: 'fiat',
  palio: 'fiat',
  siena: 'fiat',
  pulse: 'fiat',
  fastback: 'fiat',
  fiorino: 'fiat',
  kwid: 'renault',
  sandero: 'renault',
  logan: 'renault',
  duster: 'renault',
  captur: 'renault',
  oroch: 'renault',
  compass: 'jeep',
  renegade: 'jeep',
  commander: 'jeep',
  kicks: 'nissan',
  versa: 'nissan',
  frontier: 'nissan',
  march: 'nissan',
  sentra: 'nissan',
  208: 'peugeot',
  2008: 'peugeot',
  3008: 'peugeot',
  c3: 'citroen',
  c4: 'citroen',
  tiggo: 'chery',
  t7: 'caoa',
  song: 'byd',
  dolphin: 'byd',
  seal: 'byd',
};

function _fipeNorm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "civic exl 2020" → { ano: '2020', palavras: ['civic', 'exl'] } */
function fipeInterpretarBusca(texto) {
  var palavras = _fipeNorm(texto).split(' ').filter(Boolean);
  var ano = '';
  palavras = palavras.filter(function (p) {
    if (!ano && /^(19[5-9]\d|20[0-4]\d)$/.test(p)) {
      ano = p;
      return false;
    }
    return true;
  });
  return { ano: ano, palavras: palavras };
}

/** A marca da busca: o nome digitado ou a dona do modelo. */
function fipeAcharMarca(marcas, palavras) {
  var lista = marcas || [];
  var porNome = null;
  palavras.some(function (p) {
    if (p.length < 2) return false;
    porNome = lista.find(function (m) {
      return _fipeNorm(m.nome).split(' ').indexOf(p) !== -1;
    });
    return !!porNome;
  });
  if (porNome) return porNome;
  var dona = null;
  palavras.some(function (p) {
    var alvo = FIPE_MODELO_MARCA[p.replace(/\s/g, '')];
    if (!alvo) return false;
    dona = lista.find(function (m) {
      return _fipeNorm(m.nome).indexOf(alvo) !== -1;
    });
    return !!dona;
  });
  return dona;
}

/**
 * Resultados da busca: [{ tipoV, marca, marcaCodigo, modelo, modeloCodigo,
 * ano, anoCodigo, valor }] — com ano quando ele foi digitado (e o valor das
 * primeiras opções), só os modelos quando não foi.
 */
function fipeBuscar(texto, tipoV) {
  var tipo = tipoV || 'carros';
  var q = fipeInterpretarBusca(texto);
  if (!q.palavras.length) return Promise.resolve([]);
  return fipeMarcas(tipo).then(function (marcas) {
    var marca = fipeAcharMarca(marcas, q.palavras);
    if (!marca) return [];
    var marcaPalavras = _fipeNorm(marca.nome).split(' ');
    var resto = q.palavras.filter(function (p) {
      return marcaPalavras.indexOf(p) === -1;
    });
    return fipeModelos(tipo, marca.codigo).then(function (data) {
      var modelos = (data && data.modelos) || data || [];
      var achados = modelos
        .filter(function (m) {
          var nm = _fipeNorm(m.nome);
          var compacto = nm.replace(/\s/g, '');
          return resto.every(function (p) {
            return nm.split(' ').indexOf(p) !== -1 || compacto.indexOf(p) !== -1;
          });
        })
        .slice(0, 8);
      var base = achados.map(function (m) {
        return {
          tipoV: tipo,
          marca: marca.nome,
          marcaCodigo: String(marca.codigo),
          modelo: m.nome,
          modeloCodigo: String(m.codigo),
          ano: '',
          anoCodigo: '',
          valor: '',
        };
      });
      if (!q.ano) return base;
      return Promise.all(
        base.slice(0, 6).map(function (r) {
          return fipeAnos(tipo, r.marcaCodigo, r.modeloCodigo)
            .then(function (anos) {
              return (anos || [])
                .filter(function (a) {
                  return String(a.nome || a.codigo || '').indexOf(q.ano) === 0;
                })
                .map(function (a) {
                  return Object.assign({}, r, { ano: a.nome, anoCodigo: String(a.codigo) });
                });
            })
            .catch(function () {
              return [];
            });
        })
      ).then(function (listas) {
        var comAno = [].concat.apply([], listas).slice(0, 6);
        return Promise.all(
          comAno.map(function (r, i) {
            if (i > 3) return r;
            return fipeValor(tipo, r.marcaCodigo, r.modeloCodigo, r.anoCodigo)
              .then(function (v) {
                return Object.assign({}, r, {
                  valor: (v && (v.Valor || v.valor)) || '',
                  ref: (v && (v.MesReferencia || v.mesReferencia)) || '',
                });
              })
              .catch(function () {
                return r;
              });
          })
        );
      });
    });
  });
}

var _bemFipeBusca = { timer: null, seq: 0, res: [], sel: -1 };

function bemFipeBuscarDigitado() {
  clearTimeout(_bemFipeBusca.timer);
  _bemFipeBusca.timer = setTimeout(bemFipeBuscarAgora, 450);
}

function bemFipeBuscarAgora() {
  var el = document.getElementById('bemFipeResultados');
  var txt = ((document.getElementById('bemFipeBusca') || {}).value || '').trim();
  if (!el) return;
  if (txt.length < 2) {
    el.innerHTML = '';
    return;
  }
  var tipoSel = (document.getElementById('bemFipeVeiculoTipo') || {}).value || 'carros';
  var seq = ++_bemFipeBusca.seq;
  el.innerHTML =
    '<div class="bem-fipe-msg"><i class="ph ph-spinner ph-spin"></i> Buscando na tabela FIPE…</div>';
  fipeBuscar(txt, tipoSel)
    .then(function (res) {
      if (seq !== _bemFipeBusca.seq) return;
      _bemFipeBusca.res = res;
      _bemFipeBusca.sel = -1;
      bemFipeDesenharResultados();
    })
    .catch(function () {
      if (seq !== _bemFipeBusca.seq) return;
      el.innerHTML =
        '<div class="bem-fipe-msg">A tabela FIPE não respondeu agora. Tente de novo ou use "Não achei".</div>';
    });
}

function bemFipeDesenharResultados() {
  var el = document.getElementById('bemFipeResultados');
  if (!el) return;
  var res = _bemFipeBusca.res || [];
  if (!res.length) {
    el.innerHTML =
      '<div class="bem-fipe-msg">Nada encontrado. Escreva a marca junto (ex.: "honda civic 2020") ou use "Não achei".</div>';
    return;
  }
  var esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  };
  el.innerHTML = res
    .map(function (r, i) {
      return (
        '<button type="button" role="option" class="bem-fipe-op" aria-selected="' +
        (i === _bemFipeBusca.sel) +
        '" onclick="bemFipeEscolher(' +
        i +
        ')"><span>' +
        esc(r.marca.replace(/^.* - /, '') + ' ' + r.modelo + (r.ano ? ' · ' + r.ano : '')) +
        '</span><b>' +
        esc(r.valor || (r.ano ? '' : 'ver anos')) +
        '</b>' +
        (r.ref ? '<small>FIPE de ' + esc(String(r.ref).trim()) + '</small>' : '') +
        '</button>'
      );
    })
    .join('');
}

/** Escolheu uma opção: com ano, aplica; sem ano, lista os anos do modelo. */
function bemFipeEscolher(i) {
  var r = (_bemFipeBusca.res || [])[i];
  if (!r) return;
  if (r.anoCodigo) {
    _bemFipeBusca.sel = i;
    bemFipeDesenharResultados();
    bemFipeAplicar(r.tipoV, r.marcaCodigo, r.modeloCodigo, r.anoCodigo);
    return;
  }
  var el = document.getElementById('bemFipeResultados');
  if (el)
    el.innerHTML =
      '<div class="bem-fipe-msg"><i class="ph ph-spinner ph-spin"></i> Carregando os anos…</div>';
  fipeAnos(r.tipoV, r.marcaCodigo, r.modeloCodigo)
    .then(function (anos) {
      _bemFipeBusca.res = (anos || []).slice(0, 12).map(function (a) {
        return Object.assign({}, r, { ano: a.nome, anoCodigo: String(a.codigo), valor: '' });
      });
      _bemFipeBusca.sel = -1;
      bemFipeDesenharResultados();
    })
    .catch(function () {
      if (el) el.innerHTML = '<div class="bem-fipe-msg">A tabela FIPE não respondeu agora.</div>';
    });
}

// ------------------------------------------------------------
// Passos do bem novo: 1 tipo · 2 dados · 3 valores e financiamento
// ------------------------------------------------------------
function bemMarcarPasso(n) {
  var barra = document.getElementById('bemPassos');
  var txt = document.getElementById('bemPassoTxt');
  var novo = !((document.getElementById('bemEditId') || {}).value || '');
  if (barra) {
    barra.hidden = !novo || !n;
    barra.setAttribute('data-passo', String(n || 0));
  }
  if (txt) txt.textContent = novo && n ? 'Passo ' + Math.min(n, 3) + ' de 3' : '';
}

function bemMostrarPasso0(mostrar) {
  var p0 = document.getElementById('bemPasso0');
  var p1 = document.getElementById('bemPasso1');
  var a1 = document.getElementById('bemAcoesPasso1');
  if (p0) p0.style.display = mostrar ? '' : 'none';
  if (p1) p1.style.display = mostrar ? 'none' : '';
  if (a1) a1.style.display = mostrar ? 'none' : 'flex';
  bemMarcarPasso(mostrar ? 1 : 2);
}

function bemEscolherTipoNovo(tipo) {
  var sel = document.getElementById('bemTipo');
  if (sel) sel.value = tipo;
  bemOnTrocarTipo();
  bemMostrarPasso0(false);
  var busca = document.getElementById('bemFipeResultados');
  if (busca) busca.innerHTML = '';
  var foco = document.getElementById(tipo === 'veiculo' ? 'bemFipeBusca' : 'bemNome');
  if (foco) foco.focus();
}

function bemVoltarDoPasso1() {
  var editando = (document.getElementById('bemEditId') || {}).value;
  if (editando) return fecharModalBem();
  bemMostrarPasso0(true);
}

// ------------------------------------------------------------
// Detalhe do bem (canvas "Bem"): à direita no web, folha no celular
// ------------------------------------------------------------
// Usa o mesmo painel do extrato da instituição (#mpdPainel). Mostra quanto
// vale, quanto já é seu, o financiamento (parcela, prazo, juros até quitar,
// quitação), a simulação de antecipação com valores prontos e — no imóvel —
// a referência por m².
var bemPainel = { id: null, extra: 0, modo: 'prazo', contaId: null };

var _BEM_MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function _bemMesAno(d) {
  return _BEM_MESES_CURTOS[d.getMonth()] + '/' + d.getFullYear();
}

/** Mês/ano da última parcela, contando a partir do mês que vem. */
function bemQuitacao(parcelas, hoje) {
  var h = hoje || new Date();
  var n = Math.max(0, Math.round(Number(parcelas) || 0));
  if (!n) return null;
  return new Date(h.getFullYear(), h.getMonth() + n, 1);
}

/** Valores sugeridos para antecipar: 10, 20 e 50 mil (ou frações do saldo). */
function bemValoresAntecipar(saldo) {
  var sd = Number(saldo) || 0;
  if (sd <= 0) return [];
  var base = [10000, 20000, 50000].filter(function (v) {
    return v < sd;
  });
  if (base.length < 3) {
    base = [0.1, 0.25, 0.5].map(function (f) {
      return Math.max(100, Math.round((sd * f) / 100) * 100);
    });
  }
  return base;
}

/**
 * Registra uma antecipação: o saldo devedor cai, o prazo (ou a parcela) se
 * ajusta pela simulação e o dinheiro sai do caixa da conta escolhida como um
 * ajuste — fora do resultado do mês, como a transferência. O patrimônio
 * líquido não muda: sai do caixa o mesmo tanto que sai da dívida.
 */
function bemRegistrarAntecipacao(id, valor, modo, contaId) {
  var b = obterBem(id);
  var fin = b && b.financiamento;
  var v = Math.round((Number(valor) || 0) * 100) / 100;
  if (!fin || !fin.ativo || !(v > 0)) return null;
  var sd = Number(fin.saldoDevedor) || 0;
  if (v > sd) v = sd;
  var sim = finSimularAmortizacao(fin, v);
  if (!sim) return null;
  var conta = contaId && typeof obterConta === 'function' ? obterConta(contaId) : null;
  var agora = new Date();
  var registro = {
    id: 'ant_' + agora.getTime(),
    data: agora.toISOString(),
    valor: v,
    modo: modo === 'parcela' ? 'parcela' : 'prazo',
    contaId: conta ? conta.id : null,
    saldoAntes: sd,
    parcelasAntes: fin.parcelasRestantes,
    parcelaAntes: fin.valorParcela,
    valorPagoAntes: fin.valorPago,
  };
  fin.saldoDevedor = Math.round((sd - v) * 100) / 100;
  fin.valorPago = Math.round(((Number(fin.valorPago) || 0) + v) * 100) / 100;
  if (sim.quitou || fin.saldoDevedor <= 0.005) {
    fin.saldoDevedor = 0;
    fin.parcelasRestantes = 0;
  } else if (registro.modo === 'prazo') {
    fin.parcelasRestantes = sim.prazo.parcelas;
  } else {
    fin.valorParcela = Math.round(sim.parcela.novaParcela * 100) / 100;
  }
  // As parcelas que estão lançadas no Controle acompanham: prazo menor some
  // com as do fim; parcela menor muda o valor das que faltam.
  registro.controle = bemAjustarParcelasControle(b, registro, sim);
  if (registro.controle && registro.controle.grupoId)
    fin.parcelasGrupoId = registro.controle.grupoId;
  if (!Array.isArray(fin.antecipacoes)) fin.antecipacoes = [];
  fin.antecipacoes.push(registro);
  salvarBens();
  if (conta) {
    if (!Array.isArray(conta.ajustes)) conta.ajustes = [];
    conta.ajustes.push({
      id: 'aj_' + registro.id,
      valor: -v,
      data: registro.data,
      descricao: 'Antecipação · ' + (b.nome || 'financiamento'),
      bemId: b.id,
    });
    if (typeof salvarContas === 'function') salvarContas();
  }
  return { registro: registro, sim: sim };
}

// ------------------------------------------------------------
// Parcelas do financiamento no Controle
// ------------------------------------------------------------
// O bem não guarda vínculo com os lançamentos: a parcela costuma ter sido
// lançada como despesa fixa ("Financiamento apê", "Prestação do carro"). A
// série é achada pelo valor (até 15% da parcela do contrato) e, havendo mais
// de uma com esse valor, pelo nome. Achada uma vez, fica gravada em
// fin.parcelasGrupoId. Na dúvida, nada é mexido.
var BEM_PALAVRAS_PARCELA =
  /financ|presta|parcela|habita|consorc|imovel|apart|ape\b|casa|carro|veic|moto/;

function _bemNormTxt(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function _bemMesAtualIdx(hoje) {
  var h = hoje || new Date();
  return h.getFullYear() * 12 + h.getMonth();
}

/** Lançamentos ainda não pagos de uma série, do mês atual em diante, em ordem. */
function bemParcelasFuturasDoGrupo(grupoId, hoje) {
  var desde = _bemMesAtualIdx(hoje);
  return (typeof transacoes !== 'undefined' ? transacoes : [])
    .filter(function (t) {
      return t.groupId === grupoId && !t.pago && t.ano * 12 + t.mes >= desde;
    })
    .sort(function (a, c) {
      return a.ano * 12 + a.mes - (c.ano * 12 + c.mes);
    });
}

/** A série de parcelas do financiamento no Controle: groupId ou null. */
function bemAcharParcelasControle(b, parcelaRef, hoje) {
  var fin = (b && b.financiamento) || {};
  if (fin.parcelasGrupoId && bemParcelasFuturasDoGrupo(fin.parcelasGrupoId, hoje).length) {
    return fin.parcelasGrupoId;
  }
  var ref = Number(parcelaRef) || 0;
  if (!(ref > 0)) return null;
  var desde = _bemMesAtualIdx(hoje);
  var grupos = {};
  (typeof transacoes !== 'undefined' ? transacoes : []).forEach(function (t) {
    if (!t.groupId || t.pago || t.ano * 12 + t.mes < desde) return;
    if (t.categoria !== 'despesa_fixa' && t.categoria !== 'despesa_variavel') return;
    if (Math.abs((Number(t.valor) || 0) - ref) / ref > 0.15) return;
    if (!grupos[t.groupId])
      grupos[t.groupId] = { id: t.groupId, desc: t.descricao, valor: t.valor };
  });
  var lista = Object.keys(grupos).map(function (k) {
    return grupos[k];
  });
  if (!lista.length) return null;
  var nomeBem = _bemNormTxt(b.nome).split(/\s+/)[0] || '';
  var comNome = lista.filter(function (g) {
    var d = _bemNormTxt(g.desc);
    return (nomeBem.length >= 3 && d.indexOf(nomeBem) !== -1) || BEM_PALAVRAS_PARCELA.test(d);
  });
  if (lista.length === 1) return lista[0].id;
  if (comNome.length === 1) return comNome[0].id;
  return null;
}

/**
 * Ajusta a série no Controle depois da antecipação. Devolve o que mudou
 * ({ grupoId, removidos: [transação], valores: [{ id, valor }] }) para o
 * Desfazer — ou { grupoId: null } quando não achou a série.
 */
function bemAjustarParcelasControle(b, registro, sim, hoje) {
  var fin = b.financiamento || {};
  var ref =
    Number(registro.parcelaAntes) ||
    finParcelaEsperada(
      fin.sistema === 'price' ? 'price' : 'sac',
      registro.saldoAntes,
      Number(fin.taxaMensal) || 0,
      registro.parcelasAntes
    );
  var grupoId = bemAcharParcelasControle(b, ref, hoje);
  var out = { grupoId: grupoId, removidos: [], valores: [] };
  if (!grupoId) return out;
  var futuras = bemParcelasFuturasDoGrupo(grupoId, hoje);
  var quitou = sim.quitou || !(Number(fin.saldoDevedor) > 0);
  if (quitou || registro.modo === 'prazo') {
    var manter = quitou ? 0 : Math.max(0, Number(fin.parcelasRestantes) || 0);
    var sair = futuras.slice(manter);
    var ids = {};
    sair.forEach(function (t) {
      ids[t.id] = true;
      out.removidos.push(Object.assign({}, t));
    });
    for (var k = transacoes.length - 1; k >= 0; k--) {
      if (ids[transacoes[k].id]) transacoes.splice(k, 1);
    }
  } else {
    var nova = Math.round((Number(fin.valorParcela) || 0) * 100) / 100;
    if (nova > 0) {
      futuras.forEach(function (t) {
        out.valores.push({ id: t.id, valor: t.valor });
        t.valor = nova;
      });
    }
  }
  if (out.removidos.length || out.valores.length) {
    if (typeof salvarTransacoes === 'function') salvarTransacoes();
  }
  return out;
}

/** Desfaz a última antecipação: dívida, conta e parcelas do Controle voltam. */
function bemDesfazerAntecipacao(bemId, registroId) {
  var b = obterBem(bemId);
  var fin = b && b.financiamento;
  if (!fin || !Array.isArray(fin.antecipacoes)) return false;
  var i = fin.antecipacoes.findIndex(function (r) {
    return r.id === registroId;
  });
  if (i === -1) return false;
  var r = fin.antecipacoes[i];
  fin.saldoDevedor = r.saldoAntes;
  fin.parcelasRestantes = r.parcelasAntes;
  fin.valorParcela = r.parcelaAntes;
  fin.valorPago = r.valorPagoAntes;
  fin.antecipacoes.splice(i, 1);
  salvarBens();
  if (r.contaId && typeof obterConta === 'function') {
    var c = obterConta(r.contaId);
    if (c && Array.isArray(c.ajustes)) {
      c.ajustes = c.ajustes.filter(function (a) {
        return a.id !== 'aj_' + r.id;
      });
      if (typeof salvarContas === 'function') salvarContas();
    }
  }
  var ctl = r.controle || {};
  var mudou = false;
  (ctl.removidos || []).forEach(function (t) {
    if (!transacoes.some((x) => x.id === t.id)) {
      transacoes.push(t);
      mudou = true;
    }
  });
  (ctl.valores || []).forEach(function (v) {
    var t = transacoes.find((x) => x.id === v.id);
    if (t && !t.pago) {
      t.valor = v.valor;
      mudou = true;
    }
  });
  if (mudou && typeof salvarTransacoes === 'function') salvarTransacoes();
  return true;
}

function bemPainelAbrir(id) {
  var b = obterBem(id);
  if (!b) return;
  if (bemPainel.id !== id) {
    bemPainel.extra = 0;
    bemPainel.modo = 'prazo';
    bemPainel.contaId = null;
  }
  bemPainel.id = id;
  if (typeof mpPainel !== 'undefined') mpPainel.key = null;
  bemPainelDesenhar();
}

function bemPainelFechar() {
  bemPainel.id = null;
  if (typeof mpFecharPainelInst === 'function') mpFecharPainelInst();
}

/** Ações que abrem outro modal fecham o painel antes (no celular ele fica por cima). */
function bemPainelAcao(acao, id) {
  bemPainelFechar();
  if (acao === 'editar') editarBemForm(id);
  else if (acao === 'excluir') confirmarExcluirBem(id);
  else if (acao === 'fipe') bemAtualizarFipe(id);
  else if (acao === 'analise') abrirAnaliseBem(id);
  else if (acao === 'simulador') abrirModalAmortizacao(id);
}

function bemPainelExtra(v) {
  bemPainel.extra = Number(v) || 0;
  bemPainelDesenhar();
}

function bemPainelModo(m) {
  bemPainel.modo = m === 'parcela' ? 'parcela' : 'prazo';
  bemPainelDesenhar();
}

function bemPainelConta(id) {
  bemPainel.contaId = id || null;
}

function bemPainelRegistrar() {
  var id = bemPainel.id;
  var b = obterBem(id);
  if (!b || !(bemPainel.extra > 0)) return;
  var r = bemRegistrarAntecipacao(id, bemPainel.extra, bemPainel.modo, bemPainel.contaId);
  if (!r) return mostrarToast('Não deu para registrar a antecipação.', 'erro');
  var fmt = _fmtDinheiroFin();
  bemPainel.extra = 0;
  if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
  else if (typeof renderMeusBens === 'function') renderMeusBens();
  bemPainelDesenhar();
  var ctl = r.registro.controle || {};
  var nRem = (ctl.removidos || []).length;
  var nVal = (ctl.valores || []).length;
  var sobreControle = nRem
    ? ' ' + nRem + (nRem === 1 ? ' parcela saiu' : ' parcelas saíram') + ' do fim, no Controle.'
    : nVal
      ? ' As ' +
        nVal +
        ' parcelas que faltam no Controle agora são de ' +
        fmt(nVal ? obterBem(id).financiamento.valorParcela : 0) +
        '.'
      : ctl.grupoId
        ? ''
        : ' Não achei as parcelas no Controle; se estiverem lá, ajuste à mão.';
  var msg =
    'Antecipação de ' +
    fmt(r.registro.valor) +
    ' registrada' +
    (r.registro.contaId ? '' : ' (sem conta: o caixa não mudou)') +
    '.' +
    sobreControle;
  var regId = r.registro.id;
  var aoDesfazer = function () {
    if (!bemDesfazerAntecipacao(id, regId)) return;
    if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
    if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
    if (bemPainel.id === id) bemPainelDesenhar();
    mostrarToast('Antecipação desfeita.', 'sucesso');
  };
  if (typeof atualizarTelaControle === 'function') atualizarTelaControle();
  if (typeof mostrarToastDesfazer === 'function') mostrarToastDesfazer(msg, aoDesfazer, 9000);
  else mostrarToast(msg, 'sucesso', 7000);
}

function bemPainelHtml(b) {
  var esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  };
  var fmt = _fmtDinheiroFin();
  var fmtK = function (v) {
    var n = Math.abs(Number(v) || 0);
    if (n >= 1000) return 'R$ ' + (Math.round(n / 100) / 10).toLocaleString('pt-BR') + ' mil';
    return fmt(n);
  };
  var tipo = BEM_TIPOS.find(function (t) {
    return t.v === b.tipo;
  }) || { label: 'Bem', icon: 'ph-package' };
  var idEsc = esc(b.id);
  var comprado = b.dataCompra ? new Date(b.dataCompra + 'T12:00:00') : null;
  var sub = [tipo.label];
  if (b.imovel && b.imovel.areaM2) sub.push(String(b.imovel.areaM2).replace('.', ',') + ' m²');
  if (comprado && !isNaN(comprado)) sub.push('comprado em ' + _bemMesAno(comprado));

  var html =
    '<header class="mpx-cab"><span class="mpd-inst-av bem-av"><i class="ph ' +
    tipo.icon +
    '"></i></span><div class="mpx-tit"><h2>' +
    esc(b.nome) +
    '</h2><small>' +
    esc(sub.join(' · ')) +
    '</small></div><button type="button" class="mpx-fechar" aria-label="Fechar" onclick="bemPainelFechar()"><i class="ph ph-x"></i></button></header>';

  var varia = bemVariacaoCompra(b);
  html +=
    '<section class="mpx-saldo"><span class="mpd-rotulo">Vale hoje</span><div class="mpx-valor mpd-oculta">' +
    esc(fmt(b.valorAtual || 0)) +
    '</div>' +
    (varia !== null
      ? '<span class="mpd-sub">' +
        (varia >= 0 ? '+' : '−') +
        Math.abs(varia).toFixed(1).replace('.', ',') +
        '% sobre a compra (<span class="mpd-oculta">' +
        esc(fmt(b.valorCompra)) +
        '</span>)</span>'
      : '') +
    '</section>';

  var acoes = [];
  if (b.fipe && b.fipe.codigoFipe)
    acoes.push(['fipe', 'ph-arrows-clockwise', 'Atualizar FIPE', '']);
  else acoes.push(['editar', 'ph-arrows-clockwise', 'Atualizar valor', '']);
  acoes.push(['editar', 'ph-pencil-simple', 'Editar', '']);
  acoes.push(['excluir', 'ph-trash', 'Excluir', ' perigo']);
  html +=
    '<nav class="mpx-acoes" aria-label="Ações do bem">' +
    acoes
      .map(function (a) {
        return (
          '<button type="button" class="mpx-acao' +
          a[3] +
          '" data-bem="' +
          idEsc +
          '" onclick="bemPainelAcao(\'' +
          a[0] +
          '\', this.dataset.bem)"><span><i class="ph ' +
          a[1] +
          '"></i></span>' +
          a[2] +
          '</button>'
        );
      })
      .join('') +
    '</nav>';

  var fin = b.financiamento;
  var ativo = fin && fin.ativo && Number(fin.saldoDevedor) > 0;
  if (ativo) {
    var sd = Number(fin.saldoDevedor) || 0;
    var valor = Number(b.valorAtual) || 0;
    var seu = Math.max(0, valor - sd);
    var pctSeu = valor > 0 ? Math.max(0, Math.min(100, Math.round((seu / valor) * 100))) : 0;
    html +=
      '<section class="bem-seu"><div class="mpd-topo"><b>Quanto já é seu</b><span>' +
      pctSeu +
      '%</span></div><div class="bem-seu-barra" role="img" aria-label="' +
      pctSeu +
      '% já é seu"><span style="width:' +
      pctSeu +
      '%"></span></div><div class="bem-seu-leg"><span><i class="seu"></i>Seu <b class="mpd-oculta">' +
      esc(fmt(seu)) +
      '</b></span><span><i class="banco"></i>Ainda do banco <b class="mpd-oculta">' +
      esc(fmt(sd)) +
      '</b></span></div><small>É isto que entra no seu patrimônio líquido.</small></section>';

    var r = finResumo(fin, valor);
    var parcela = r.parcelaInformada > 0 ? r.parcelaInformada : r.parcelaEsperada;
    var quita = bemQuitacao(r.parcelasRestantes);
    var mesQueVem = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    var jurosPrimeira = sd * (r.taxaMensal || 0);
    var porCem = parcela > 0 ? Math.round((jurosPrimeira / parcela) * 100) : 0;
    html +=
      '<section class="bem-fin"><div class="mpd-topo"><b>Financiamento</b><span>' +
      (r.sistema === 'price' ? 'Price' : 'SAC') +
      (r.taxaMensal ? ' · ' + _fmtTaxaMensal(r.taxaMensal) : '') +
      '</span></div><div class="bem-fin-grade">' +
      '<div><span>Parcela de ' +
      FATURA_MESES_BEM[mesQueVem.getMonth()] +
      '</span><b class="mpd-oculta">' +
      esc(fmt(parcela)) +
      '</b></div>' +
      '<div><span>Faltam</span><b>' +
      r.parcelasRestantes +
      (r.parcelasRestantes === 1 ? ' parcela' : ' parcelas') +
      '</b></div>' +
      '<div><span>Juros até quitar</span><b class="mpd-oculta">≈ ' +
      esc(fmtK(r.jurosRestantes)) +
      '</b></div>' +
      '<div><span>Quitação</span><b>' +
      (quita ? _bemMesAno(quita) : '—') +
      '</b></div></div>' +
      (porCem > 0 && porCem < 100
        ? '<small>De cada R$ 100 da próxima parcela, R$ ' +
          porCem +
          ' são juros. ' +
          (r.sistema === 'sac'
            ? 'A proporção cai a cada mês.'
            : 'A proporção cai ao longo do contrato.') +
          '</small>'
        : '') +
      '</section>';

    // Simular antecipação
    var opcoes = bemValoresAntecipar(sd);
    if (!(bemPainel.extra > 0) && opcoes.length)
      bemPainel.extra = opcoes[Math.min(1, opcoes.length - 1)];
    var sim =
      bemPainel.extra > 0 ? finSimularAmortizacao(fin, Math.min(bemPainel.extra, sd)) : null;
    html +=
      '<section class="bem-ant"><b>Simular antecipação</b><div class="mpd-seg bem-ant-vals" role="group" aria-label="Quanto antecipar">' +
      opcoes
        .map(function (v) {
          return (
            '<button type="button" aria-pressed="' +
            (v === bemPainel.extra) +
            '" onclick="bemPainelExtra(' +
            v +
            ')">' +
            esc(fmtK(v)) +
            '</button>'
          );
        })
        .join('') +
      '</div><div class="mpd-seg" role="group" aria-label="O que reduzir"><button type="button" aria-pressed="' +
      (bemPainel.modo === 'prazo') +
      '" onclick="bemPainelModo(\'prazo\')">Reduzir o prazo</button><button type="button" aria-pressed="' +
      (bemPainel.modo === 'parcela') +
      '" onclick="bemPainelModo(\'parcela\')">Reduzir a parcela</button></div>';
    if (sim) {
      var depois = bemPainel.modo === 'prazo' ? sim.prazo : sim.parcela;
      var quitaDepois = bemQuitacao(depois.parcelas);
      html +=
        '<div class="bem-ant-res">' +
        (sim.quitou
          ? 'Com ' +
            esc(fmtK(bemPainel.extra)) +
            ' você <b>quita o financiamento</b> e deixa de pagar <b>≈ ' +
            esc(fmtK(sim.jurosAtuais)) +
            '</b> de juros.'
          : bemPainel.modo === 'prazo'
            ? 'Economiza <b>≈ ' +
              esc(fmtK(depois.economia)) +
              '</b> de juros e quita <b>' +
              depois.parcelasReduzidas +
              (depois.parcelasReduzidas === 1 ? ' mês' : ' meses') +
              ' antes</b>' +
              (quitaDepois ? ' (' + _bemMesAno(quitaDepois) + ')' : '') +
              '.'
            : 'Economiza <b>≈ ' +
              esc(fmtK(depois.economia)) +
              '</b> de juros e a parcela cai para <b>' +
              esc(fmt(depois.novaParcela)) +
              '</b>.') +
        '</div>';
      var contas = typeof contasComSaldo === 'function' ? contasComSaldo() : [];
      if (!bemPainel.contaId && contas.length) {
        var maior = contas.slice().sort(function (a, c) {
          return (c.saldo || 0) - (a.saldo || 0);
        })[0];
        bemPainel.contaId = maior && (maior.id || (maior.conta && maior.conta.id));
      }
      if (contas.length) {
        html +=
          '<label class="bem-ant-conta">Sai de<select onchange="bemPainelConta(this.value)">' +
          contas
            .map(function (c) {
              var cid = c.id || (c.conta && c.conta.id);
              var nome = c.nome || (c.conta && c.conta.nome) || '';
              return (
                '<option value="' +
                esc(cid) +
                '"' +
                (cid === bemPainel.contaId ? ' selected' : '') +
                '>' +
                esc(nome) +
                (c.saldo != null ? ' · saldo ' + esc(fmt(c.saldo)) : '') +
                '</option>'
              );
            })
            .join('') +
          '</select></label>';
      }
      html +=
        '<button type="button" class="btn-acao bem-ant-btn" onclick="bemPainelRegistrar()">Registrar antecipação de ' +
        esc(fmtK(Math.min(bemPainel.extra, sd))) +
        '</button><button type="button" class="mpx-mais" data-bem="' +
        idEsc +
        '" onclick="bemPainelAcao(\'simulador\', this.dataset.bem)">Outro valor e detalhes</button>' +
        '<small>Estimativa pelo sistema e pela taxa do contrato. O valor exato vem do banco.</small>';
    }
    html += '</section>';
    if (typeof finConflitoNaoRevisado === 'function' && finConflitoNaoRevisado(fin)) {
      html +=
        '<button type="button" class="mpx-mais" data-bem="' +
        idEsc +
        '" onclick="bemPainelAcao(\'analise\', this.dataset.bem)">Confira a taxa do contrato</button>';
    }
  } else if (fin && fin.ativo === false) {
    html += '<p class="mpd-sub">Quitado.</p>';
  }

  if (b.imovel && (b.imovel.areaM2 || b.imovel.valorM2)) {
    var area = Number(b.imovel.areaM2) || 0;
    var m2 = Number(b.imovel.valorM2) || 0;
    html +=
      '<section class="bem-imovel">' +
      (area ? '<span>Área</span><b>' + String(area).replace('.', ',') + ' m²</b>' : '') +
      (m2
        ? '<span>Referência do bairro</span><b class="mpd-oculta">' + esc(fmt(m2)) + '/m²</b>'
        : '') +
      (area && m2
        ? '<span>Estimativa por m²</span><b class="mpd-oculta">' + esc(fmt(area * m2)) + '</b>'
        : '') +
      '</section>';
  }
  return html;
}

var FATURA_MESES_BEM = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function bemPainelDesenhar() {
  var b = obterBem(bemPainel.id);
  var p = document.getElementById('mpdPainel');
  if (!b || !p) return;
  p.innerHTML = '<div class="mpx">' + bemPainelHtml(b) + '</div>';
  p.hidden = false;
  document.body.classList.add('mpd-painel-aberto');
}

function bemAtualizarFipe(id) {
  var b = obterBem(id);
  if (!b || !b.fipe) return;
  var f = b.fipe;
  fipeValor(f.tipoVeiculo, f.marcaCodigo, f.modeloCodigo, f.anoCodigo)
    .then(function (data) {
      var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
      var valorNum = typeof parseBRL === 'function' ? parseBRL(valorStr) : 0;
      if (valorNum > 0) {
        editarBem(id, {
          valorAtual: valorNum,
          fipe: Object.assign({}, b.fipe, {
            valor: data.Valor || data.valor || '',
            mesReferencia: data.MesReferencia || data.mesReferencia || '',
            ultimaAtualizacao: new Date().toISOString(),
          }),
        });
        renderMeusBens();
        if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
        mostrarToast('Valor FIPE de ' + b.nome + ' atualizado.', 'sucesso');
      }
    })
    .catch(function () {
      mostrarToast('Erro ao atualizar FIPE de ' + b.nome + '.', 'erro');
    });
}

var _fipeAutoEmAndamento = false;
var FIPE_INTERVALO_MS = 24 * 60 * 60 * 1000;

function bemAtualizarFipeAuto() {
  if (_fipeAutoEmAndamento) return;
  var veiculos = bensAtivos().filter(function (b) {
    return b.tipo === 'veiculo' && b.fipe && b.fipe.tipoVeiculo && b.fipe.marcaCodigo;
  });
  var agora = Date.now();
  var pendentes = veiculos.filter(function (b) {
    var ultima = b.fipe.ultimaAtualizacao ? new Date(b.fipe.ultimaAtualizacao).getTime() : 0;
    return agora - ultima > FIPE_INTERVALO_MS;
  });
  if (!pendentes.length) return;
  _fipeAutoEmAndamento = true;
  var atualizados = 0;

  function processar(i) {
    if (i >= pendentes.length) {
      _fipeAutoEmAndamento = false;
      if (atualizados > 0) {
        renderMeusBens();
        if (typeof renderMeuPatrimonio === 'function') renderMeuPatrimonio(true);
        mostrarToast(
          atualizados +
            ' veículo' +
            (atualizados > 1 ? 's' : '') +
            ' atualizado' +
            (atualizados > 1 ? 's' : '') +
            ' pela FIPE.',
          'sucesso'
        );
      }
      return;
    }
    var b = pendentes[i];
    var f = b.fipe;
    fipeValor(f.tipoVeiculo, f.marcaCodigo, f.modeloCodigo, f.anoCodigo)
      .then(function (data) {
        var valorStr = (data.Valor || data.valor || '').replace(/[^\d,]/g, '');
        var valorNum = typeof parseBRL === 'function' ? parseBRL(valorStr) : 0;
        if (valorNum > 0) {
          editarBem(b.id, {
            valorAtual: valorNum,
            fipe: Object.assign({}, b.fipe, {
              valor: data.Valor || data.valor || '',
              mesReferencia: data.MesReferencia || data.mesReferencia || '',
              ultimaAtualizacao: new Date().toISOString(),
            }),
          });
          atualizados++;
        }
      })
      .catch(function () {})
      .then(function () {
        processar(i + 1);
      });
  }
  processar(0);
}

// ============================================================
// === UI — RENDERIZAÇÃO DA LISTA                            ===
// ============================================================

// Quanto o bem valorizou ou desvalorizou sobre o que foi pago. Só aparece
// com valor de compra informado e diferença de pelo menos 0,1%.
function bemVariacaoCompra(b) {
  var compra = Number(b && b.valorCompra) || 0;
  var atual = Number(b && b.valorAtual) || 0;
  if (!(compra > 0) || !(atual > 0)) return null;
  var pct = ((atual - compra) / compra) * 100;
  return Math.abs(pct) < 0.05 ? null : pct;
}

function bemVariacaoCompraHtml(b) {
  var pct = bemVariacaoCompra(b);
  if (pct === null) return '';
  return (
    '<span class="mp-bem-var" style="display:block;font-size:11px;font-weight:600;color:' +
    (pct > 0 ? 'var(--tinta-verde)' : 'var(--tinta-vermelho)') +
    ';">' +
    (pct > 0 ? '+' : '−') +
    Math.abs(pct).toFixed(1).replace('.', ',') +
    '% sobre a compra</span>'
  );
}

function renderMeusBens() {
  var wrap = document.getElementById('listaBens');
  if (!wrap) return;
  // No celular a lista tem formato próprio (appliquei-mobile.js).
  if (typeof mobRenderBens === 'function') mobRenderBens();

  var ativos = bensAtivos();
  var arquivados = bens.filter(function (b) {
    return b.arquivado;
  });
  var todos = ativos.concat(arquivados);

  if (!todos.length) {
    wrap.innerHTML =
      '<div class="mp-empty"><i class="ph ph-package"></i>Nenhum bem cadastrado.</div>';
    return;
  }

  var fmt =
    typeof formatarMoeda === 'function'
      ? formatarMoeda
      : function (v) {
          return 'R$ ' + v.toFixed(2);
        };
  var iconMap = {};
  BEM_TIPOS.forEach(function (t) {
    iconMap[t.v] = t.icon;
  });

  wrap.innerHTML = todos
    .map(function (b) {
      var arq = b.arquivado;
      var icon = iconMap[b.tipo] || 'ph-package';
      var valorTxt = b.valorAtual ? fmt(b.valorAtual) : '—';
      var fipeBadge = '';
      if (b.fipe && b.fipe.codigoFipe) {
        fipeBadge =
          '<span class="mp-mov-tipo receita" style="font-size:9px;cursor:pointer;" onclick="bemAtualizarFipe(\'' +
          b.id +
          '\')" title="Clique para atualizar o valor FIPE">' +
          '<i class="ph ph-arrows-clockwise"></i> FIPE ' +
          (b.fipe.mesReferencia || '') +
          '</span>';
      }
      // Linha de contexto do imóvel: área, tipo e bairro/cidade. Cabe na mesma
      // linha da descrição — sem card novo na página.
      var linhas = [];
      if (b.descricao) linhas.push(b.descricao);
      if (b.tipo === 'imovel' && b.imovel) {
        var det = [];
        if (b.imovel.areaM2) det.push(b.imovel.areaM2.toLocaleString('pt-BR') + ' m²');
        var rotuloTipo = (
          BEM_IMOVEL_TIPOS.filter(function (t) {
            return t.v === b.imovel.tipoImovel;
          })[0] || {}
        ).label;
        if (rotuloTipo) det.push(rotuloTipo);
        var end = b.imovel.endereco;
        if (end && (end.bairro || end.cidade)) {
          det.push([end.bairro, end.cidade].filter(Boolean).join(', '));
        }
        if (det.length) linhas.push(det.join(' · '));
      }
      var descTxt = linhas.length
        ? '<span class="mp-bem-sub">' + linhas.join(' · ') + '</span>'
        : '';
      // Bem financiado: o valor de mercado continua sendo o número principal (é
      // ele que os KPIs somam); logo abaixo, em letra menor, o líquido e a
      // dívida — sem card novo na página.
      var linhaFin = '';
      var fin = b.financiamento;
      if (fin && fin.ativo && fin.saldoDevedor > 0) {
        var liquido = (b.valorAtual || 0) - fin.saldoDevedor;
        linhaFin =
          '<span class="mp-bem-fin">' +
          'líquido <strong style="color:' +
          (liquido >= 0 ? 'var(--cor-txt-primaria)' : 'var(--cor-erro)') +
          ';">' +
          fmt(liquido) +
          '</strong> · devendo <strong style="color:var(--cor-erro);">' +
          fmt(fin.saldoDevedor) +
          '</strong></span>';
      }
      // Conflito nunca revisado: o card avisa e leva direto à análise, senão a
      // pessoa nunca descobre que a taxa gravada não bate com a parcela dela.
      if (fin && fin.ativo && finConflitoNaoRevisado(fin)) {
        linhaFin +=
          '<button type="button" onclick="abrirAnaliseBem(\'' +
          b.id +
          '\')" style="margin-top:4px;padding:2px 8px;font-size:10px;font-weight:700;border-radius:99px;border:1px solid var(--cor-borda-amber);background:var(--cor-bg-amber);color:var(--cor-txt-amber);cursor:pointer;font-family:Figtree,sans-serif;">' +
          '<i class="ph-fill ph-warning"></i> confira a taxa</button>';
      }
      var financiadoAtivo = !arq && fin && fin.ativo && fin.saldoDevedor > 0;
      var btnAnalise = financiadoAtivo
        ? '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="abrirAnaliseBem(\'' +
          b.id +
          '\')" title="Ver o custo do financiamento"><i class="ph ph-receipt" style="color:var(--cor-patrimonio);"></i></button>'
        : '';
      var btnSimular = financiadoAtivo
        ? '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="abrirModalAmortizacao(\'' +
          b.id +
          '\')" title="Antecipar parcelas"><i class="ph ph-scissors" style="color:var(--cor-primaria);"></i></button>'
        : '';

      var acoes = arq
        ? '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBem(\'' +
          b.id +
          '\',{arquivado:false});renderMeusBens();" title="Restaurar"><i class="ph ph-arrow-counter-clockwise"></i></button>'
        : btnAnalise +
          btnSimular +
          '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="editarBemForm(\'' +
          b.id +
          '\')" title="Editar"><i class="ph ph-pencil-simple"></i></button>' +
          '<button class="btn-secundario" style="padding:3px 8px;font-size:11px;" onclick="confirmarExcluirBem(\'' +
          b.id +
          '\')" title="Excluir"><i class="ph ph-trash" style="color:var(--cor-erro);"></i></button>';

      // Grade nomeada em vez de dois blocos flex: no celular os quatro botões e
      // o valor em DM Mono não encolhem, e sobravam 82px de 332 para o nome e o
      // endereço — que quebravam quase letra a letra. Cada peça agora tem área
      // própria e o CSS decide o arranjo por largura.
      return (
        '<div class="mp-inst-item mp-bem' +
        (arq ? ' mp-arq' : ' mp-bem-clicavel') +
        '"' +
        (arq
          ? ' style="opacity:.55;"'
          : ' data-bem="' +
            b.id +
            '" onclick="if(!event.target.closest(\'button\'))bemPainelAbrir(this.dataset.bem)"') +
        '>' +
        '<i class="ph-fill ' +
        icon +
        ' mp-bem-icone"></i>' +
        '<div class="mp-bem-id">' +
        '<span class="mp-inst-nome">' +
        b.nome +
        (arq ? ' <span class="mp-bem-arq">(arquivado)</span>' : '') +
        '</span>' +
        descTxt +
        (fipeBadge ? '<span class="mp-bem-selos">' + fipeBadge + '</span>' : '') +
        '</div>' +
        '<div class="mp-bem-valor">' +
        '<span class="mp-inst-valor valor-mascarado">' +
        valorTxt +
        '</span>' +
        bemVariacaoCompraHtml(b) +
        '</div>' +
        // A linha do financiamento é IRMÃ do valor, não filha: só filho direto
        // da grade recebe grid-area. Aninhada, ela voltava a dividir a coluna do
        // valor e a levava a 248px de max-content.
        linhaFin +
        '<div class="mp-bem-acoes">' +
        acoes +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}
