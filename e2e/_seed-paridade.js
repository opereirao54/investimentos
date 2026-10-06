'use strict';

// Dados de exemplo do teste de paridade (e2e/paridade-mobile.spec.js).
//
// Uma conta vazia esconde metade das ações (extrato sem linhas, patrimônio
// sem bens, sonhos sem cartão) e o teste passaria sem olhar para elas. Por
// isso a página nasce com quatro meses de lançamentos, duas contas, uma
// carteira de ações e FIIs, dois sonhos e dois bens — um deles financiado.
//
// Roda NA PÁGINA via addInitScript, antes do app ler o localStorage. Os
// meses são relativos a hoje, para o teste não envelhecer.
function semearParidade() {
  if (localStorage.getItem('__paridade')) return;
  const hoje = new Date();
  const doisDig = (n) => String(n).padStart(2, '0');
  const agora = hoje.toISOString();
  const contas = [
    { id: 'c_nu', nome: 'Nubank', tipo: 'banco', saldoInicial: 20000 },
    { id: 'c_itau', nome: 'Itaú', tipo: 'banco', saldoInicial: 3400 },
  ].map((c) => ({
    ...c,
    dataSaldoInicial: hoje.getFullYear() - 1 + '-01-01',
    cor: null,
    arquivada: false,
    criadaEm: agora,
    atualizadaEm: agora,
  }));

  const tx = [];
  const add = (descricao, valor, categoria, base, dia, extra) => {
    const d = new Date(base.getFullYear(), base.getMonth(), dia);
    const dv = d.getFullYear() + '-' + doisDig(d.getMonth() + 1) + '-' + doisDig(dia);
    const n = tx.length;
    tx.push({
      id: 'par' + n,
      groupId: 'gpar' + n,
      descricao,
      valor,
      categoria,
      mes: d.getMonth(),
      ano: d.getFullYear(),
      data: dv + 'T12:00:00.000Z',
      dataVencimento: dv,
      pago: true,
      obs: '',
      ...extra,
    });
  };
  for (let atras = 3; atras >= 0; atras--) {
    const base = new Date(hoje.getFullYear(), hoje.getMonth() - atras, 1);
    const atual = atras === 0;
    const nu = { banco: 'Nubank', contaId: 'c_nu' };
    const itau = { banco: 'Itaú', contaId: 'c_itau' };
    add('Salário', 13700, 'receita', base, 5, nu);
    add('Aluguel', 2150, 'despesa_fixa', base, 10, {
      ...nu,
      categoriaDespesa: 'moradia',
      pago: !atual,
    });
    add('Internet', 120, 'despesa_fixa', base, 15, {
      ...nu,
      categoriaDespesa: 'moradia',
      pago: !atual,
    });
    add('Mercado', 1180, 'despesa_variavel', base, 6, { ...nu, categoriaDespesa: 'mercado' });
    add('Transporte', 610, 'despesa_variavel', base, 14, {
      ...itau,
      categoriaDespesa: 'transporte',
      pago: !atual,
    });
    add('Farmácia', 125, 'despesa_variavel', base, 25, {
      ...itau,
      categoriaDespesa: 'saude',
      pago: !atual,
    });
    // Um gasto fora do padrão no mês corrente: faz "O que notamos" ter o
    // que dizer, e o teste olhar também para os cartões de aviso.
    add('Restaurante', atual ? 1900 : 280, 'despesa_variavel', base, 3, {
      ...nu,
      categoriaDespesa: 'restaurantes',
    });
  }

  const compra = (id, ticker, quantidade, preco, data, subcategoria) => ({
    id,
    ticker,
    quantidade,
    preco_op: preco,
    tipo: 'compra',
    data_op: data + 'T12:00:00.000Z',
    categoria: 'renda_variavel',
    subcategoria,
    corretora: 'Rico',
  });
  const anoPassado = hoje.getFullYear() - 1;
  const compras = [
    compra(9001, 'PETR4', 440, 31.4, anoPassado + '-03-11', 'acoes'),
    compra(9002, 'ITUB4', 600, 28.4, anoPassado + '-05-02', 'acoes'),
    compra(9003, 'WEGE3', 260, 38.9, anoPassado + '-07-15', 'acoes'),
    compra(9005, 'KNRI11', 120, 131, anoPassado + '-09-01', 'fiis'),
  ];

  const sonho = (id, nome, valorTotal, valorAtual, prazoMeses, categoria) => ({
    id,
    nome,
    descricao: '',
    valorTotal,
    prazoMeses,
    valorAtual,
    categoria,
    esforco: 'moderado',
    dataCriacao: agora,
    dataInicio: agora,
    dataFim: new Date(hoje.getFullYear(), hoje.getMonth() + prazoMeses, 1).toISOString(),
    mesesRestantes: prazoMeses,
    planoVinculado: false,
    aportes: [{ valor: valorAtual, data: agora.slice(0, 10), tipo: 'inicial' }],
  });

  const bem = (id, nome, tipo, valorAtual, valorCompra, financiamento) => ({
    id,
    nome,
    tipo,
    descricao: '',
    valorAtual,
    valorCompra,
    dataCompra: anoPassado - 2 + '-03-01',
    fipe: null,
    imovel: null,
    financiamento,
    arquivado: false,
    criadoEm: agora,
    atualizadoEm: agora,
  });

  localStorage.setItem('appliquei_contas', JSON.stringify(contas));
  localStorage.setItem('futurorico_transacoes', JSON.stringify(tx));
  localStorage.setItem('futurorico_compras', JSON.stringify(compras));
  localStorage.setItem(
    'appliquei_sonhos',
    JSON.stringify([
      sonho('sonho_1', 'Viagem ao Japão', 34000, 12400, 15, 'viagem'),
      sonho('sonho_2', 'Reserva de emergência', 25000, 22000, 8, 'reserva'),
    ])
  );
  localStorage.setItem(
    'appliquei_bens',
    JSON.stringify([
      bem('bem_1', 'Apartamento', 'imovel', 520000, 480000, {
        valorFinanciado: 300000,
        saldoDevedor: 190000,
        parcela: 2800,
        parcelasRestantes: 120,
        taxaMensal: 0.8,
      }),
      bem('bem_2', 'Carro', 'veiculo', 98000, 120000, null),
    ])
  );
  localStorage.setItem('__paridade', '1');
}

module.exports = { semearParidade };
