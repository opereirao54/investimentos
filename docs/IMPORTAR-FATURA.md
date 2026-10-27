# Importar fatura do cartão (Nubank)

Ideia de um testador: subir a fatura do cartão e o app já identificar as
despesas. Este documento listou os casos de uso, o que pode dar errado e como
mitigar ANTES de escrever código, e continua sendo o mapa do que o código faz.

**Status: implementado (27/10/2026).** Telas → Faturas → "Importar fatura do
Nubank". Código:

| Peça                      | Onde                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| Motor (sem DOM)           | `web/appliquei-importar-fatura.js`                                  |
| Tela                      | `web/appliquei-importar-fatura-ui.js` + `#telaImportarFatura`       |
| Palavras → categoria      | `web/appliquei-categorias-palavras.js` (a mesma tabela do Telegram) |
| Registro das importações  | `appliquei_importacoes_fatura` (sincroniza; serve ao Desfazer)      |
| Testes                    | `test/importar-fatura.test.js`, `test/integracao-inv27-*.test.js`   |
| Fatura real (anonimizada) | `test/fixtures/nubank/Nubank_2026-11-05.ofx`                        |
| Trava de integração       | INV-27 em `.claude/integracoes/mapa.json`                           |

Decisões do fundador (27/10/2026):

- Banco da primeira versão: **Nubank**. Formato: **OFX e CSV**; PDF e foto
  ficam para depois (exigem IA).
- D1, D2, D3, D4 e D7 como recomendado abaixo. **D5 não precisa**: a fatura
  sempre entra pendente. **D6 fica para depois.**

## Como o app guarda uma compra no cartão hoje

Base para tudo o que vem abaixo (`criarLancamentos` em
`web/appliquei-aba-controle-financeiro.js`):

| Campo              | O que é                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `categoria`        | `'cartao_credito'`                                                            |
| `cartaoId`         | o cartão cadastrado (INV-17: precisa existir)                                 |
| `dataVencimento`   | o vencimento da fatura — **é isto que define a fatura** (`faturaLancamentos`) |
| `mes` / `ano`      | competência = mês do vencimento (INV-08)                                      |
| `valor`            | valor DA PARCELA (o total dividido pelo número de parcelas)                   |
| `descricao`        | no parcelado, termina em `(i/n)`                                              |
| `groupId`          | liga as parcelas da mesma compra                                              |
| `categoriaDespesa` | a categoria de gasto (mercado, transporte…)                                   |
| `pago`             | `false` até a fatura ser paga                                                 |
| `data`             | carimbo de quando foi LANÇADO, não a data da compra                           |
| `cartaoFixoMensal` | assinatura no cartão (Netflix…): o app já projeta 60 meses                    |

Duas consequências importantes:

1. **Não existe campo para a data da compra.** Hoje ninguém precisava dela.
   A importação traz essa data — ver a decisão D4.
2. **Não existe lançamento negativo no cartão.** `validarLancamento` recusa
   valor ≤ 0. Estorno e crédito na fatura não têm onde morar — ver D3.

## O fluxo proposto

1. Na tela **Faturas** do cartão: botão **"Importar fatura do arquivo"** (importa para aquele cartão).
2. O usuário escolhe o arquivo (CSV ou OFX que o Nubank manda por e-mail).
3. **Tudo é lido no próprio aparelho.** O arquivo não vai para o servidor nem
   para IA nenhuma. Nenhum endpoint novo (o teto de 12 continua).
4. **Tela de revisão** (nada é gravado antes dela):
   - cabeçalho: cartão e vencimento, só para ler (vêm da fatura — ver F1),
     total do arquivo;
   - uma linha por item, com data, descrição limpa, valor, parcela, categoria
     sugerida (editável) e status: **nova** / **já lançada** / **não é compra**;
   - rodapé: "Total do banco R$ X · No app depois de importar R$ Y". Se não
     bater, diz quanto e por quê.
5. **Confirmar** grava tudo de uma vez, num único salvamento.
6. Mensagem final: "32 compras importadas, 4 já estavam lançadas, 2 ignoradas"
   e um botão **Desfazer importação**.

## A tela, depois da revisão de UX (27/10/2026)

O fluxo acima continua; a revisão de usabilidade mudou como ele aparece:

1. **Decisões primeiro.** Tudo o que precisa de uma resposta (compra parecida,
   conflito de parcela, compra em outra fatura, reajuste, estorno de compra que
   está no app) fica no topo, em "Decida antes de importar", com duas opções
   escritas por extenso (rádio grande, alvo de 44px) e uma já escolhida.
2. **"Parecida" tem escolha.** "É a mesma compra" (padrão) troca o valor do
   app pelo do banco e a fatura fecha no centavo; "Compras diferentes" importa
   esta também.
3. **Estorno de compra que está no app.** "Apagar do app" (padrão quando nome e
   valor batem) tira o lançamento junto; o Desfazer devolve no mesmo lugar.
4. **Compras novas** com "Marcar/Desmarcar todas" e a categoria num seletor em
   pílula; "Já estão no app" e "Não entram" ficam recolhidos.
5. **Rodapé honesto:** total do banco × total do app depois de importar, o
   porquê de cada diferença, e "E mais N parcelas nas próximas faturas, até
   mês/ano". O botão diz o que faz ("Importar 11 compras" / "Aplicar os
   ajustes") e fica desligado quando nada muda.
6. **Tela de concluído** com o total (igual ao do banco ou não), o que entrou,
   o que foi ajustado e o que ficou sem categoria.
7. **Desfazer na própria fatura:** "Importada do arquivo em dd/mm · Desfazer"
   fica na tela da fatura até alguém marcar algo como pago (aí o caixa já
   mexeu e o Desfazer some).
8. **Atalhos:** "Tem o arquivo da fatura? Importar de uma vez" no lançamento de
   cartão; "Cadastrar cartão" quando não há nenhum; instruções completas só
   na primeira vez.
9. **Cartão e vencimento não se trocam na revisão** (pedido do fundador,
   27/10): o cartão é o da tela de onde se abriu a importação, e o
   vencimento é o mês da fatura no dia do cartão no app. Campo só quando não
   há como saber: seletor de cartão quando a fatura chega pelo Compartilhar
   (ou pelo atalho sem cartão escolhido) e há mais de um cartão; data quando
   o arquivo não traz data nenhuma e o cartão não tem dia.
10. **Compartilhar no Android:** no anexo do e-mail do Nubank, "Compartilhar →
    Appliquei" abre a revisão direto (`share_target` no
    `manifest.webmanifest` + `web/sw-compartilhar.js`). O service worker tem
    escopo `/web/`, não guarda cache de nada do app e só trata esse POST — o
    resto passa direto para a rede. Exige o app instalado (PWA) no Android; no
    iPhone continua o botão de escolher arquivo.

## Parcelado que começou antes (relato de 27/10/2026)

"Comprei em 10x, lancei como 1/10, mas a compra já estava na 2/10, e não
tinha como corrigir as próximas faturas." Duas correções em
`web/appliquei-aba-controle-financeiro.js`:

- **No lançamento:** com Nº de parcelas > 1 aparece **Parcela atual**. Com
  "2", entram só 2/10…10/10 (9 lançamentos), a 2/10 na fatura escolhida; o
  valor de cada parcela continua total ÷ 10.
- **Na edição de uma parcela:** "Esta é a parcela [2] de [10] → Corrigir a
  série" (`renumerarSerieParcelas`). Mostra antes o que vai mudar: renomeia a
  série inteira, apaga a que sobra no fim, cria a que falta (se o total
  aumentou). Vencimentos e valores não mudam. Se a correção apagaria uma
  parcela já paga, recusa e pede para desfazer o pagamento antes. Testes em
  `test/parcelas-corrigir.test.js`.

## A pergunta 3, com um exemplo

Você comprou uma TV em **10x de R$ 300** em agosto e **nunca lançou no app**.
A fatura de outubro do Nubank traz a linha:

> `TV Loja X - Parcela 3/10 · R$ 300,00`

As parcelas 1 e 2 já foram cobradas nas faturas de agosto e setembro. O que o
app faz com essa linha?

- **(a) Só a parcela de outubro.** Entra R$ 300 em outubro e pronto. Em
  novembro o app não sabe que vem mais uma, e o aviso de caixa apertado não
  enxerga as 7 parcelas que faltam. Só aparecem se a próxima fatura for
  importada.
- **(b) Esta e as que faltam (3 a 10).** Entram R$ 300 em cada fatura de
  outubro a maio. O app já mostra as próximas faturas com a TV dentro, como se
  a compra tivesse sido lançada lá em agosto. As parcelas 1 e 2 **não** entram
  (são faturas passadas, já pagas).

**Recomendação: (b).** É o que o app faz quando você lança um parcelado à mão,
e é o que dá valor ao aviso de caixa. O cuidado: ao importar a fatura de
novembro, a linha "Parcela 4/10" tem de ser reconhecida como **já lançada**
(caso P2 abaixo).

## O arquivo do Nubank (o que a fatura real mostrou)

O Nubank envia por e-mail o CSV/OFX de **faturas fechadas** (Resumo de faturas
→ escolher a fatura → compartilhar/enviar por e-mail). Pelo que se sabe hoje,
e que **precisa ser confirmado com um arquivo real antes de codar**:

- CSV com cabeçalho `date,title,amount` (às vezes com `category`), data
  `AAAA-MM-DD`, valor com ponto decimal;
- compras positivas; pagamento recebido, estorno e crédito negativos;
- parcela no título: `Loja - Parcela 3/10`;
- IOF de compra internacional numa linha própria;
- o nome do arquivo traz a data (provavelmente o vencimento): `Nubank_AAAA-MM-DD.csv`;
- só para conta pessoa física (PJ não exporta).

**Confirmado com arquivos reais** (OFX e CSV de uma fatura de um testador, que
não ficam no repositório — os testes usam faturas inventadas no mesmo formato):

- OFX SGML, `CHARSET:1252`; compra é `TRNAMT` negativo, "Pagamento recebido"
  positivo; cada linha tem um `FITID` próprio (usado contra reimportação);
- `LEDGERBAL` é o total da fatura (as compras somadas, sem o pagamento);
- o nome do arquivo traz o vencimento: `Nubank_2026-11-05.ofx`;
- parcela no título, `Loja - Parcela 3/10` — e **a parcela antiga vem com a
  data do início do ciclo**, não a da compra. Por isso `dataCompra` só é
  gravada na compra à vista e na parcela 1; nas outras a fatura mostra "—";
- títulos com intermediador: `Asa*Nome`, `Rappi*Rappi Brasil Int`,
  `Amazonmktplc*Loja`, `Loja - NuPay`;
- o CSV é `date,title,amount`, com valor brasileiro entre aspas (`"18,37"`) e
  o pagamento com espaço depois do sinal (`"- 1.234,56"`); não tem FITID nem
  o total, e lê as mesmas linhas que o OFX da mesma fatura.

**Achado na primeira rodada na tela:** uma compra lançada pelo Telegram com o
valor arredondado ("padaria 20") e o nome que o banco dá à loja, sem nada em
comum, entrava como compra nova — centavos de diferença bastavam. Virou regra: diferença de
até R$ 0,50 (ou 1%) é **parecida** mesmo com outro nome, e só entra se o
usuário marcar.

**Ainda falta:** uma fatura real com estorno e com compra internacional (IOF).
Esses casos estão cobertos pelas faturas sintéticas (abaixo), mas a forma
exata como o Nubank escreve o título do estorno ainda não foi vista.

## Casos de uso

| #   | Caso                                                   | O que o app faz                                                                           |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| U1  | Primeira importação, nada lançado no cartão            | Todas as linhas viram **nova**                                                            |
| U2  | Lançou parte pelo Telegram ou à mão durante o mês      | Essas viram **já lançada** (desmarcadas); o resto entra                                   |
| U3  | Importa todo mês, sempre depois de fechar              | Mesmo fluxo; parcelas e assinaturas de meses anteriores reconhecidas                      |
| U4  | Compra parcelada nova (Parcela 1/n)                    | Cria as n parcelas, igual ao lançamento manual                                            |
| U5  | Parcelado antigo nunca lançado (Parcela 3/10)          | Cria da 3 à 10 (recomendação da pergunta 3)                                               |
| U6  | Assinatura já cadastrada como fixa no cartão (Netflix) | Reconhece a projeção daquele mês como **já lançada**; se o preço mudou, oferece atualizar |
| U7  | Assinatura nunca cadastrada                            | Entra como compra comum; sugere "marcar como fixa" (D6)                                   |
| U8  | Compra internacional + IOF                             | Duas linhas; IOF vai para a categoria "Impostos e Taxas"                                  |
| U9  | Estorno de uma compra da mesma fatura                  | Ver D3                                                                                    |
| U10 | Pagamento da fatura anterior ("Pagamento recebido")    | **não é compra**: ignorado, aparece riscado na revisão                                    |
| U11 | Juros, multa, encargos de atraso                       | Entram como despesa "Impostos e Taxas", destacados (é dinheiro saindo)                    |
| U12 | Cartão virtual / adicional do Nubank                   | Mesma fatura, mesmo cartão no app                                                         |
| U13 | Duas contas Nubank (dois cartões)                      | O usuário escolhe em qual cartão do app importar                                          |
| U14 | Não tem cartão Nubank cadastrado                       | Oferece cadastrar ali mesmo (nome, fechamento, vencimento) antes de seguir                |
| U15 | Importa a mesma fatura de novo                         | Tudo vira **já lançada**; aviso "esta fatura já foi importada em DD/MM"                   |
| U16 | Importa uma fatura antiga (de 3 meses atrás)           | Permitido; aviso de que é fatura passada; marcar como paga (D5)                           |
| U17 | Quer desfazer logo depois                              | **Desfazer importação** apaga só o que aquela importação criou                            |
| U18 | Usa no celular (arquivo chega por e-mail)              | Passo a passo na própria tela: "salve o anexo no Arquivos/Downloads e escolha aqui"       |

## O que pode dar errado e a mitigação

### Arquivo

| #   | Risco                                                             | Mitigação                                                                                                       |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A1  | Arquivo de outro banco, planilha qualquer, PDF                    | Detecta pelo cabeçalho; mensagem: "Este arquivo não parece a fatura do Nubank. Envie o CSV ou OFX do e-mail."   |
| A2  | Nubank muda as colunas (ordem, nome, coluna nova)                 | Lê pelo NOME da coluna, não pela posição; aceita colunas extras; se faltar data/título/valor, recusa com o nome |
| A3  | Acentos quebrados ("CafÃ©")                                       | Tenta UTF-8, cai para Latin-1 se aparecer caractere inválido                                                    |
| A4  | Separador `;` e vírgula decimal (arquivo aberto e salvo no Excel) | Detecta separador e formato do número; "1.234,56" e "1234.56" viram o mesmo valor                               |
| A5  | Título com vírgula entre aspas (`"Loja, filial 2"`)               | Leitor de CSV de verdade (aspas, aspas escapadas), não `split(',')`                                             |
| A6  | Arquivo vazio ou só cabeçalho                                     | "Nenhuma compra encontrada neste arquivo"                                                                       |
| A7  | Arquivo enorme (alguém sobe um extrato de anos)                   | Limite (ex.: 1 MB e 500 linhas); acima disso, recusa explicando                                                 |
| A8  | Data em formato inesperado                                        | Aceita `AAAA-MM-DD` e `DD/MM/AAAA`; linha com data inválida fica marcada para o usuário corrigir, não some      |
| A9  | Arquivo malicioso (fórmula `=HYPERLINK`, HTML no título)          | Título tratado sempre como texto; escapado ao desenhar (mesmo `esc` do resto do app)                            |

### Fatura e cartão

| #   | Risco                                                                  | Mitigação                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Vencimento errado → compras na fatura e no mês errados (INV-08)        | O mês vem do nome do arquivo (ou das datas das compras); o dia, do cartão no app — a importação nunca muda o cartão e cada cartão tem uma fatura por mês. Mostrado na revisão |
| F2  | O app recalcular a fatura pelo dia de fechamento e discordar do Nubank | NÃO recalcula: na importação, todas as linhas vão para o vencimento escolhido. Quem decide a fatura é o banco                                                                 |
| F3  | Vencimento num fim de semana (o Nubank pode ter mudado o dia)          | A fatura entra no dia do cartão no app, no mesmo mês; o cadastro do cartão só muda pela tela do cartão                                                                        |
| F4  | Compra feita no dia do fechamento cai na fatura seguinte               | Coberto por F2: o arquivo já diz em qual fatura ela está                                                                                                                      |
| F5  | Cartão apagado depois da importação                                    | Mesma regra que já vale para cartão com lançamentos (INV-17)                                                                                                                  |
| F6  | Fatura aberta (ainda não fechada)                                      | O Nubank só exporta fechada; se aparecer, avisa que pode mudar até fechar                                                                                                     |

### Duplicidade (o maior risco)

| #   | Risco                                                           | Mitigação                                                                                                                                                                          |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Compra já lançada pelo Telegram ou à mão vira duplicada         | Procura no MESMO cartão e na MESMA fatura um lançamento com valor igual (tolerância de centavos); se achar, **já lançada** e desmarcada. Descrição parecida reforça, não é exigida |
| P2  | Parcela 4/10 de uma compra já criada pela importação anterior   | Guarda na parcela a origem (`importacao: { arquivo, linha, parcela }`); a parcela 4/10 casa com a que já existe pelo grupo + número da parcela                                     |
| P3  | Duas compras legítimas iguais (dois cafés de R$ 6 no mesmo dia) | O casamento é **um para um**: cada lançamento do app só cobre uma linha. Dois cafés no arquivo e um no app → um já lançado, um novo                                                |
| P4  | Valor do app diferente do Nubank (lançou R$ 50, foi R$ 49,90)   | Não casa automático; mostra "parecido com: mercado R$ 50 (Telegram)" com opção "é o mesmo"                                                                                         |
| P5  | Lançou na fatura errada (no mês seguinte)                       | Procura também na fatura vizinha; se achar, oferece "mover para esta fatura" em vez de duplicar                                                                                    |
| P6  | Importar a mesma fatura duas vezes                              | Coberto por P1/P2; e cada importação fica registrada (arquivo, data, quantas linhas) para o aviso do U15                                                                           |
| P7  | Lançou parcelado com número de parcelas diferente do Nubank     | Mostra o conflito; não cria nada sozinho                                                                                                                                           |

### Parcelas

| #   | Risco                                                                     | Mitigação                                                                                                 |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | "Parcela 3/10" lida errado (título com números, "3/10" em outro contexto) | Só reconhece o padrão no FIM do título (` - Parcela N/M`); N ≤ M ≤ 48 (o limite do app)                   |
| R2  | Valor da parcela × total: o app guarda o valor da parcela                 | Cria cada parcela com o valor da linha; não divide nada                                                   |
| R3  | Última parcela com centavos diferentes (arredondamento do banco)          | As parcelas futuras usam o valor da atual; a diferença de centavos se corrige na importação seguinte (P4) |
| R4  | Descrição: `(3/10)` do app × `Parcela 3/10` do Nubank                     | Converte para o padrão do app: `TV Loja X (3/10)`                                                         |

### Estornos, créditos e o que não é compra

| #   | Risco                                                                           | Mitigação                                                                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| E1  | Valor negativo quebra o lançamento (o app recusa valor ≤ 0)                     | Linhas negativas nunca viram lançamento comum — ver D3                              |
| E2  | "Pagamento recebido" entrar como receita ou abater compras                      | Reconhecido e ignorado: o pagamento da fatura já é feito no app pelo "Pagar fatura" |
| E3  | Total do app não bater com o do Nubank por causa de estorno ou crédito ignorado | O rodapé explica a diferença linha a linha                                          |

### Categoria sugerida

| #   | Risco                                                              | Mitigação                                                                                                                                              |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Categoria errada                                                   | É sugestão, editável na revisão. Sem palpite → fica sem categoria e vai para "precisa da sua atenção"; nunca uma categoria inventada                   |
| C2  | Regras de palavra duplicadas entre o bot e a importação divergirem | Usar a MESMA tabela de palavras do bot (`telegram-parser.js`), extraída para um arquivo comum aos dois — não copiar                                    |
| C3  | Títulos crus do Nubank ("MP*LOJAX", "PAG*JOSE", "IFD*")            | Limpeza de prefixos conhecidos de maquininha (MP*, PAG*, IFD*, EC*…) antes de categorizar e para a descrição; o título original fica guardado em `obs` |
| C4  | Aprender errado (corrigiu uma vez, vale para sempre)               | Aprende pelo nome limpo da loja; a próxima importação mostra a categoria aprendida, ainda editável                                                     |
| C5  | Mandar dados para IA                                               | Primeira versão sem IA. Se um dia usar o Gemini, vai só o nome da loja, como o bot já faz, e a Política de Privacidade precisa citar                   |

### Gravação, sincronização e as outras telas

| #   | Risco                                                                                      | Mitigação                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Gravar metade (fecha o app no meio)                                                        | Monta tudo em memória e grava num único salvamento; a revisão não grava nada                                                                             |
| G2  | Importar no celular e não aparecer no PC                                                   | Mesmo caminho de sincronização de qualquer lançamento; teste específico (ver `DIAGNOSTICO-SYNC.md`: as transações vão num JSON só, com limite de 800 KB) |
| G3  | Uma importação de 80 compras + parcelas futuras engordar o JSON das transações             | Medir num caso realista (12 meses de importação) contra o limite de 800 KB antes de lançar                                                               |
| G4  | Desfazer apagar o que não devia                                                            | Cada lançamento criado leva o id da importação; desfazer apaga só esses, e só se ainda não estiverem pagos                                               |
| G5  | Fatura importada já paga no banco (D5) e o caixa da conta pagadora                         | Marcar como paga debita a conta pagadora (INV-17) — e o saldo do app pode ficar errado se o usuário já tinha registrado o pagamento. Ver D5              |
| G6  | Aviso "cobrança repetida" e "gasto fora da curva" dispararem em massa depois da importação | Rodar os detectores do Sistema inteligente sobre um mês importado e conferir que só avisam o que faz sentido                                             |
| G7  | Relatório mensal, aviso de caixa, extrato por data                                         | Passar `validar-integracoes` e `simular-acao` antes de dar por pronto (as skills do projeto para isso)                                                   |

### Celular e uso

| #   | Risco                                                           | Mitigação                                                                                                            |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| M1  | No iPhone, o anexo do e-mail não aparece no seletor de arquivos | Instrução na tela: tocar no anexo → Compartilhar → Salvar em Arquivos → voltar ao app e escolher                     |
| M2  | Tela de revisão com 60 linhas no celular                        | Agrupar: primeiro "precisa da sua atenção" (conflitos, sem categoria), depois "novas", depois "já lançadas" fechadas |
| M3  | Usuário confirma sem olhar                                      | Padrões seguros: duplicata desmarcada, conflito não importa sozinho, totais sempre visíveis                          |

## Decisões (tomadas em 27/10/2026)

- **D1 — Parcelado antigo (pergunta 3):** recomendação **(b)**, criar da
  parcela atual até a última.
- **D2 — Assinatura fixa com preço novo (U6):** atualizar o valor das
  próximas automaticamente, ou só avisar? Recomendação: **perguntar** na
  revisão.
- **D3 — Estorno e crédito:** o app não tem lançamento negativo no cartão.
  Opções:
  - (a) estorno de compra **da mesma fatura**: a compra e o estorno se anulam e
    nenhum dos dois entra;
  - (b) estorno de compra **de outra fatura**: mostrar e não importar, com a dica
    "edite a compra original";
  - (c) criar um tipo "crédito no cartão" (mexe no modelo de dados e em várias
    telas).

  Recomendação: **(a) + (b)** na primeira versão; (c) só se aparecer muito.

- **D4 — Data da compra:** guardar num campo novo `dataCompra` e mostrar na
  fatura; ou deixar só na descrição. Recomendação: **campo novo**, que não mexe
  em competência nem em caixa (quem manda continua `dataVencimento` e `pago`).
- **D5 — Fatura antiga já paga:** **não precisa** (fundador). A fatura sempre
  entra pendente; quem já pagou usa "Marcar como paga".
- **D6 — Sugerir "marcar como assinatura" (U7):** **fica para depois.**
- **D7 — Plano:** é parte do Pro (sem custo, porque roda no aparelho).

## Como está testado

Ninguém tem cartão em todos os bancos para testar com arquivo de verdade. A
garantia vem de cinco camadas, que rodam no CI a cada PR (dialetos, robustez e caça
também vão fundo, toda semana, em `.github/workflows/cacar-importacao.yml`):

| Camada                        | Arquivo                                                                                             | O que prova                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Casos escritos                | `test/importar-fatura.test.js`                                                                      | Cada risco desta análise (A1–A9, P1–P7, R1–R4, D1–D4, C1–C4, G4) com um teste legível; o fluxo inteiro na sandbox do app; o formato do lançamento igual ao manual                                                                                                                                                                                                                                                                                                                                      |
| Faturas sintéticas × dialetos | `test/importar-fatura-dialetos.test.js` + `test/_faturas-sinteticas.js`                             | O gerador inventa a vida de um cartão (compras, parcelas que avançam, IOF, juros, anuidade, estorno, crédito antigo, pagamento, saldo em atraso) e escreve cada fatura em **12 formatos** de arquivo. Para cada uma: lê igual à verdade, linha a linha (D1–D3); o app fica com as mesmas compras, o mesmo total e o número certo de parcelas (D4); a diferença de totais é explicada e fecha no centavo (D5); competência certa (D6); reimportar — no mesmo formato ou noutro — não cria nada (D7, D8) |
| Arquivo estragado             | `test/importar-fatura-robustez.test.js`                                                             | Faturas válidas cortadas, com linhas apagadas, duplicadas, bytes trocados, sem cabeçalho, com lixo: nunca quebra, recusa com mensagem ou lê o que dá, e nunca cria lançamento com valor ou data inválidos (R1–R4)                                                                                                                                                                                                                                                                                      |
| Caça de furos                 | `test/simulacao-importacao.test.js` + `test/_sequencias-importacao.js` + `npm run cacar:importacao` | Sequências aleatórias de uso real por meses: lançar pelo Telegram (com valor arredondado e outro nome), importar meses fora de ordem, reimportar noutro formato, desfazer, pagar. Depois de cada ação: nenhuma compra duplicada ou faltando, total igual ao do banco, desfazer volta ao estado anterior, uma fatura por mês mesmo com o cartão vencendo noutro dia no app, invariantes INV-08/20/27 (IMP01–IMP08)                                                                                      |
| Tela e compartilhar           | `test/importar-fatura-tela.test.js`                                                                 | As escolhas da revisão (mesma × diferente, apagar estornada e desfazer na mesma ordem), o Desfazer na tela da fatura, o rodapé com as parcelas futuras, o botão desligado quando nada muda, e o service worker do compartilhar (guarda o arquivo, abre o app, não toca no resto)                                                                                                                                                                                                                       |

**Os 12 formatos** cobrem o que os bancos fazem: OFX SGML (Nubank), OFX XML,
OFX numa linha só, OFX com vírgula decimal e `NAME` no lugar de `MEMO`; CSV
do Nubank (atual e antigo), CSV do Excel em Latin-1 e em UTF-8 com BOM,
compra negativa, colunas a mais com a parcela numa coluna própria ("3/10" ou
"3 de 10"), "R$" no valor, data DD/MM/AAAA e colunas em outra ordem.

**Os testes testam de verdade:** cada camada foi conferida sabotando o código
de propósito (tirar o Latin-1, a coluna de parcela, o pareamento do estorno,
o saldo em atraso, cada correção da caça) — e o teste falhou em todas.

**O que a caça já achou e corrigiu** (cada um com trava em
`test/simulacao-importacao.test.js`):

1. importar os meses fora de ordem duplicava as parcelas;
2. "mover da fatura vizinha" roubava a parcela do mês seguinte;
3. a regra de conflito de parcelas roubava a parcela de outra compra na mesma
   loja;
4. o casamento guloso pela ordem das linhas trocava compras (juros × ótica);
5. a compra estornada lançada pelo Telegram com valor arredondado ficava órfã;
6. R$ 52,00 contava como igual a R$ 51,99;
7. lançamento à vista casava com parcela só pelo valor;
8. mover de uma fatura já importada fazia uma compra sumir;
9. a compra à vista casava com a parcela de outra compra na mesma loja;
10. o aviso de estorno mandava apagar uma compra legítima só pelo valor;
11. "pet" não casava com o nome grudado da maquininha (`MP*PETSHOPAMIGOFIEL`);
12. com duas compras parecidas na mesma loja, uma estornada, o aviso mandava
    apagar o lançamento da compra legítima — agora o par mais parecido e de
    valor mais perto decide;
13. com o cartão vencendo noutro dia no app (dia 10 no app, dia 5 no banco),
    a importação não via o que já estava lançado no mês, podia duplicar e
    abria uma segunda fatura no mesmo mês. Agora um cartão tem uma fatura por
    mês: o que está no app é procurado pelo mês, e a fatura importada entra
    no dia do cartão no app (o cartão nunca muda). Invariante nova da caça:
    IMP08.

Última rodada funda: 20.000 sequências de 30 ações (600 mil ações), todas
limpas.

**Outros bancos.** O leitor não é "do Nubank": entende OFX (o padrão que
quase todo banco exporta) e CSV com colunas de data, descrição e valor em
vários nomes. O que é do Nubank é o que foi conferido com arquivo real. Um
arquivo de outro banco entra com o aviso "não parece do Nubank, confira a
revisão". Banco novo com formato diferente: um arquivo de exemplo vira um
dialeto em `test/_faturas-sinteticas.js`, e todas as camadas passam a cobri-lo.

Também: `validar-integracoes` (INV-08, INV-20 e a nova INV-27) e o fluxo no
navegador (Playwright, computador e celular).

## Fora da primeira versão

PDF e foto (precisam de IA), outros bancos, fatura aberta, importação
automática (Open Finance), lançamento negativo no cartão (D3-c).
