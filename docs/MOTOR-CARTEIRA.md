# Motor da Carteira Recomendada

Como a aba **Carteira Recomendada** sai de "quanto investir em cada classe" para
"quais ativos comprar, em que proporção e quantas cotas".

| Camada           | Onde vive                                           | Responsabilidade                                          |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------- |
| Dados de mercado | `api/market.js` (`op=fundamentals`, `op=rendafixa`) | Buscar, normalizar e cachear indicadores                  |
| Motor            | `web/appliquei-motor-carteira.js`                   | Pontuar ativos e montar o plano de aporte (puro, sem DOM) |
| Tela             | `web/appliquei-aba-carteira-recomendada.js`         | Buscar, desenhar e reagir a cliques                       |

O motor não toca em DOM, rede nem Firebase. É por isso que roda em `node --test`
sem browser (`test/motor-carteira.test.js`).

---

## 1. Dados de mercado

Tudo entra em `api/market.js` via `?op=` — o Vercel Hobby limita a 12 functions.
O que não cabe numa function (processar ZIP de dezenas de MB em 15s e 256 MB)
roda como job separado.

| Classe           | Fonte primária                           | Complemento                                                                 |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Ações            | **CVM — DFP + FCA** (job de ingestão)    | **Yahoo Finance** enquanto a CVM não chega; BRAPI: preço, volume, proventos |
| FIIs             | **CVM — Informe Mensal**                 | BRAPI: preço, proventos                                                     |
| ETFs, BDRs       | BRAPI                                    | —                                                                           |
| Criptos          | CoinGecko `/coins/markets`               | —                                                                           |
| Renda fixa       | **Tesouro Direto** (`op=rendafixa`)      | BCB, para converter a taxa                                                  |
| Selic, CDI, IPCA | **BCB — SGS + Focus** (`op=indicadores`) | —                                                                           |

A fonte primária dos fundamentos **não é** uma API comercial. O motivo é
medido, não estético: com o plano grátis da BRAPI, 13 dos 16 indicadores de
ação chegam nulos, nenhum ativo é pontuado e o ranking não existe. A CVM
publica de graça, sem chave e sem cota, o documento que a companhia é
legalmente obrigada a entregar — e é auditável pelo cliente, que é o que
sustenta a confiança num produto pago.

### `GET /api/market?op=fundamentals&tickers=BBAS3,MXRF11,BTC`

Auth: Firebase Bearer. Cache: `marketFundamentals/{TICKER}`.

**As duas fontes convivem no mesmo documento sem se destruir.** Cada uma grava
no seu ramo — `cvm` (job de ingestão) e `mercado` (esta op) — e a junção
acontece só na leitura, em `comporFundamentos()`.

Isso não é organização, é correção: a resposta da BRAPI traz `null` explícito
em quase todo campo fundamentalista, e um `merge: true` plano por cima apagaria
os indicadores que a ingestão acabou de calcular.

### Três fontes empilhadas

O documento tem três ramos — `cvm`, `yahoo` e `mercado` — e a junção acontece
só na leitura. **O Yahoo existe porque a CVM depende de um job semanal**, e sem
ele o produto passa o primeiro dia (ou a primeira semana, se o job não estiver
configurado) mostrando "dados insuficientes" para a bolsa inteira. Ele não
compete com a CVM: entra apenas onde ela ainda não chegou, e a procedência
mostrada na tela diz qual foi.

| Ramo      | Quem escreve                   | Validade | Papel                                                                  |
| --------- | ------------------------------ | -------- | ---------------------------------------------------------------------- |
| `cvm`     | job de ingestão                | semanas  | Fonte primária, auditável, com exercício declarado                     |
| `yahoo`   | `op=fundamentals`, sob demanda | 7 dias   | Cobre o intervalo até a CVM chegar, e o que ela não cobre (BDRs, ETFs) |
| `mercado` | `op=fundamentals`              | 24h      | Preço, valor de mercado, volume, proventos                             |

O `quoteSummary` do Yahoo exige cookie + crumb desde 2023; a autenticação é
feita uma vez e guardada na memória do container. Como é **um pedido por
ticker**, há teto por requisição e **orçamento de tempo calculado a partir do
que resta** dos 15s de `maxDuration` — o que não couber fica sem o ramo `yahoo`
e é buscado na chamada seguinte. Cobertura parcial converge em duas ou três
aberturas da aba; estourar o limite devolveria 504 e o utilizador perderia até
o que já tinha sido buscado.

Regras da composição:

- a CVM vence o Yahoo, e o Yahoo vence o `null` da cotação;
- a CVM vence onde tem dado;
- o mercado entra com o que só ele tem — preço, valor de mercado, volume, proventos;
- **P/L e P/VP não existem em nenhuma das duas sozinha**: nascem do lucro e do
  patrimônio da CVM cruzados com o valor de mercado;
- lucro negativo não vira P/L — "sem P/L" e "P/L negativo" dizem coisas
  diferentes ao motor, e inventar o segundo mentiria sobre a origem;
- só a idade do ramo `mercado` dispara nova busca: uma DFP é anual, não vence
  em 24 horas.

Da BRAPI, o trabalho real não é buscar, é **normalizar**: ela devolve razão num
campo (`returnOnEquity: 0.185`) e percentagem em outro (`debtToEquity: 45.3`), e
vários indicadores não existem em campo nenhum:

| Indicador do motor              | Como é obtido                                                     |
| ------------------------------- | ----------------------------------------------------------------- |
| `payout`                        | dividendos dos últimos 12 meses ÷ LPA                             |
| `dy`, `dyMedio5a`, `dyMedio36m` | janelas sobre `cashDividends`                                     |
| `consistenciaDividendos`        | **meses distintos** com pagamento nos últimos 24                  |
| `liquidezDiaria`                | `regularMarketVolume × preço`                                     |
| `dividaLiquidaEbitda`           | `(totalDebt - totalCash) / ebitda` — só quando não há dado da CVM |

Cada conversão está coberta em `test/market-fundamentals.test.js` — um fator 100
trocado não quebra nada, só faz o ranking inteiro mentir.

### Ingestão da CVM — `scripts/ingest-cvm.js`

Roda no GitHub Actions (`.github/workflows/ingest-cvm.yml`), semanalmente e sob
demanda. Não roda no Vercel por duas razões concretas: `vercel.json` define
`maxDuration: 15` e `memory: 256` para `api/**`, e os 2 crons do plano Hobby já
estão ocupados (`market warmup` e `reconcile`).

O que ele faz:

1. baixa o **FCA** (`fca_cia_aberta_valor_mobiliario`) e lê o vínculo oficial
   ticker ↔ **CNPJ** — é isto que substitui a lista escrita à mão e abre o
   universo para a bolsa inteira. Sem FCA, cai para o mapa manual casado por
   nome (`scripts/lib/mapa-cvm.json`), com universo reduzido;
2. baixa as DFP dos últimos N exercícios (`BPA_con`, `BPP_con`, `DRE_con`,
   `DFC_MI_con`);
3. extrai as contas do plano padrão e calcula ROE, ROIC, margens, liquidez
   corrente, dívida líquida/EBITDA, dívida líquida/PL e CAGR de receita e lucro;
4. lê o **lucro por ação** (grupo `3.99.01` da DRE) e os **dividendos e JCP
   pagos** (grupo `6.03` da DFC) — é o que preenche os pilares de Valuation e
   Dividendos sem depender de fonte paga (ver abaixo);
5. baixa o Informe Mensal de FII e extrai patrimônio, cotistas e **vacância** —
   o dado que nenhuma API gratuita entrega;
6. busca **cotação de todo o universo** (preço e volume);
7. grava nos ramos `cvm` e `mercado` de `marketFundamentals/{TICKER}`.

#### A chave de junção é o CNPJ, não o `CD_CVM`

A primeira execução real devolveu universo vazio em silêncio — `0 tickers`, `0
companhias com dados` — com o arquivo certo aberto e as colunas resolvidas. O
FCA identifica a companhia por `CNPJ_Companhia` e **nunca teve `CD_CVM`**.
Procurar por uma identificação que o arquivo não tem devolve zero sem erro
nenhum.

O CNPJ é a única identificação presente nos três arquivos (FCA, DFP e
cadastro), e por isso é a chave. O índice da DFP responde pelas **duas**
(`cnpj:…` e `cd:…`) para o caminho antigo continuar a funcionar, e a busca
tenta as duas chaves da companhia. CNPJ é comparado por dígitos e `CD_CVM` sem
zeros à esquerda: como texto, a companhia era separada dela mesma.

#### Valor de mercado sem fonte paga

O `v8/chart` do Yahoo — a única via de cotação que dispensa cadastro — devolve
preço mas **não** valor de mercado. E o `quoteSummary`, que devolveria, responde
429 tanto do Vercel **quanto do runner do GitHub Actions**: a suposição de que
um IP não limitado resolveria foi testada e desmentida pelo log do job.

Sem valor de mercado não há P/L, P/VP nem EV/EBITDA, e o pilar de Valuation
ficaria vazio para a bolsa inteira. A saída está no próprio arquivo da CVM:

    ações  = lucro líquido ÷ lucro por ação   (DRE, grupo 3.99.01)
    valor de mercado = preço × ações
    DY     = dividendo por ação ÷ preço       (DFC, grupo 6.03)

O que a conta recusa fazer, de propósito:

- **LPA diluído não entra.** No plano da CVM, `3.99.01` é o básico e `3.99.02` o
  diluído; as folhas trazem só a classe na descrição (`ON`, `PN`), então quem os
  separa é o código, nunca o texto.
- **ON e PN com LPA diferente devolvem `null`.** Uma divisão só não soma duas
  classes; um P/L errado é pior do que um P/L ausente.
- **LPA fora de `[0,0001; 1000]` é recusado** — é erro de escala do emissor
  (`MIL` numa linha por ação), não empresa excepcional.
- **A contagem é conferida pelo P/VP** antes de valer. O patrimônio não passou
  pela contagem de ações, e por isso denuncia um erro de escala nela: P/VP fora
  de `[0,01; 100]` descarta o valor de mercado derivado inteiro.
- **Na DFC vale o agregado, não a soma das folhas.** O filtro por descrição
  reconhece "Dividendos Pagos" mas pode não reconhecer a linha vizinha; somando
  folhas, o que não fosse reconhecido sumia e o payout saía menor do que é.

Fica de fora o `dyMedio5a`: exige preço histórico, que nenhuma destas fontes
entrega. É reportado como métrica ausente, não estimado.

#### Banco e seguradora usam outro plano de contas

Na DFP, o código `2.03` é "Patrimônio Líquido" no plano industrial e **outra
conta** no plano das instituições financeiras. Casar por código devolvia um
número real, da conta errada, sem erro nenhum — o Banco do Brasil aparecia com
ROE de 43,4% (o real é ~20%) e patrimônio ~6x abaixo do verdadeiro.

Duas defesas, ambas necessárias:

1. **Patrimônio, ativo total, receita e lucro casam por DESCRIÇÃO primeiro.** A
   frase "Patrimônio Líquido Consolidado" é a mesma nos três planos; o código
   não é. O código fica como reserva, para arquivo antigo sem `DS_CONTA`.
2. **O plano é identificado pelo próprio balanço.** O padrão separa circulante
   de não circulante; banco e seguradora não. Fora do plano padrão o código
   deixa de servir de reserva — ali ele não é reserva, é armadilha —, e
   dívida líquida, EBITDA e liquidez corrente saem **nulos**.

O resultado é que um banco é pontuado por ROE, margem, P/L, P/VP e dividendos,
e não por "dívida líquida/EBITDA de 12,49x" — que não significa nada quando a
intermediação financeira É a operação. A identificação exige sinal positivo
(contas interfinanceiras, depósitos, provisões técnicas), nunca a mera ausência
da linha de circulante: um balanço truncado não pode virar banco.

#### O vínculo ticker ↔ FII sai de um código, não de um nome

Para ações o universo vem do FCA, que declara o código de negociação de cada
companhia. Para fundos imobiliários não há FCA, e o caminho óbvio — casar o nome
do fundo contra o cadastro de fundos da CVM — foi **desmentido pela execução
real**:

```
584 fundos imobiliários de 46805 no cadastro
"MAXI" aparece em: (nenhum dos 584)
"CSHG" aparece em: CSHG OCEANUS | CSHG RESIDENCIAL      (nenhum é o HGLG11)
```

Não é o nome que mudou: `cad_fi.csv` não cobre os fundos listados em bolsa.
Nenhum ajuste de string conserta uma fonte que não tem o dado.

O vínculo passou a sair do **próprio Informe Mensal de FII**, em duas vias:

1. uma coluna de código de negociação, se a CVM publicar uma — direta;
2. senão, a raiz do `Codigo_ISIN` da cota. O ISIN de cota de fundo brasileiro
   tem a forma `BR` + RAIZ + `CTF` + 3 dígitos, e a RAIZ **é** a raiz do ticker:
   `MXRF11 ↔ BRMXRFCTF004`, `HGLG11 ↔ BRHGLGCTF003`. A B3 é a agência nacional
   de numeração; a raiz não é convenção nossa, é o código que ela atribuiu.

Nas duas vias o vínculo vem de um campo publicado — não há tabela escrita à mão
para envelhecer, e um FII novo entra sozinho. A raiz procurada é sempre a do
ticker pedido: nenhum ticker é inventado a partir do índice, e um código que
aparece com dois CNPJs (sucessão de fundo) é marcado, não escondido.

Duas armadilhas do mesmo ZIP, ambas da família "a busca acha a coisa errada":

- **o ZIP anual tem um arquivo por mês.** Pegar a primeira entrada que casava
  com o prefixo entregava janeiro em agosto — sem erro, com números plausíveis.
  Agora todos os meses são concatenados e o desempate é por data de referência.
- **os campos moram em membros diferentes.** Patrimônio e cotistas no `geral`,
  dividend yield no `complemento`, vacância no de ativos. Escolher um membro de
  véspera deixava metade dos campos vazia; os três são lidos e completados campo
  a campo.

O P/VP de FII sai de **preço ÷ valor patrimonial da cota**, os dois publicados —
sem contagem de cotas no meio para errar de escala.

#### O que a leitura do log real corrigiu

A primeira execução contra a CVM de verdade — e as três seguintes — encontraram
quatro classes de defeito que **nenhum teste de unidade via**, porque cada peça
estava certa isoladamente:

| rodada | o que provou                            | o que expôs                                                      |
| ------ | --------------------------------------- | ---------------------------------------------------------------- |
| 1      | —                                       | universo vazio: junção por `CD_CVM` num arquivo que só tem CNPJ  |
| 2      | 477 tickers, 8 companhias casadas       | LPA ×1000, dividendo zero falso, 404 anônimo                     |
| 3      | LPA 2,40 / 0,19 / 0,95                  | ROE 43,4% num banco, 3 URLs de FII em 404                        |
| 4      | PL 193,6 bi no BBAS3, dividendos 9/14   | dívida/EBITDA de banco                                           |
| 5      | valuation 14/14 pela contagem declarada | ELET3 e AESO3 com 0,00 bi de ações                               |
| 6      | contagem implausível recusada (11/14)   | o `cad_fi.csv` não contém os FIIs listados                       |
| 7      | 9 dos 10 FIIs casados pelo ISIN         | `Percentual_Dividend_Yield_Mes` é razão; XPML11 com duas classes |
| 8      | ELET3 = 2.028.544 **mil** ações         | a escala da quantidade varia de linha para linha                 |

O padrão comum: **a busca não falhava, acertava o alvo errado** — sem exceção,
sem `null`, com um número plausível o suficiente para ninguém olhar duas vezes.
O que os encontrou foi cruzar cada número derivado com uma grandeza pública
conhecida.

**Garantia central: nunca gravar número que não se sustenta.** Coluna ausente,
conta inexistente e resultado fora da faixa plausível viram `null` com motivo
registado. Empresa sem nenhum indicador aproveitável é pulada e reportada, nunca
gravada pela metade.

Três defesas concretas, cada uma com teste:

| Risco                                | Defesa                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout da CVM mudar (já mudou antes) | Colunas por lista de apelidos; contas por código **e** por descrição; o que faltar é nomeado no relatório                                                       |
| Casar o ticker com a empresa errada  | Correspondência exata vence a parcial; ambiguidade é **reportada e pulada** — indicadores plausíveis apontando para outra companhia é o pior resultado possível |
| Escala trocada (MIL vs unidade)      | `ESCALA_MOEDA` aplicada por linha, e faixas de sanidade por indicador — um ROE de 4000% é descartado, não gravado                                               |

Detalhes que custam caro se ficarem errados:

- só entra `ORDEM_EXERC = ÚLTIMO`; cada arquivo traz o exercício corrente e o
  anterior, e misturar daria dois valores para a mesma conta;
- dívida líquida só existe se **alguma** conta de dívida existir — somar dois
  `null` como zero faria um banco alavancado parecer empresa sem dívida e ganhar
  nota 10 no pilar Endividamento;
- EBITDA só é reconstruído com a depreciação da DFC; EBIT não é servido como se
  fosse EBITDA;
- ROIC usa a alíquota **efetiva** da DRE, caindo para os 34% nominais quando ela
  sai de `[0, 45%]`;
- linha de CSV com contagem de campos diferente do cabeçalho é descartada —
  aceitar deslocaria todas as colunas seguintes.

**Como o dado começa a chegar.** Enquanto a ingestão não gravar, ações e FIIs
não têm indicador nenhum e as classes caem para a carteira do consultor como
reserva — a tela declara isso. Três caminhos para destravar:

| Caminho          | O que exige                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**        | `npm run ingest:cvm` (dry-run, sem credencial nenhuma), depois `--gravar` com `FIREBASE_SERVICE_ACCOUNT_BASE64`                           |
| **Pull request** | Abrir PR que toque na ingestão dispara o dry-run automático; o relatório sai nos logs, sem setup                                          |
| **Agendado**     | Só depois do merge: `schedule` e `workflow_dispatch` **só disparam a partir do branch padrão**. Exige o secret configurado no repositório |

O dry-run sozinho **nunca faz nada pontuar** — ele não escreve. Quem escreve é
`--gravar`, e é isso que o agendamento faz depois de o dry-run passar.

**Operação.** O primeiro uso deve ser `--dry-run`, e o relatório revisado por
uma pessoa:

```bash
node scripts/ingest-cvm.js --dry-run --anos=1 --limite=20   # confere layout, rápido
node scripts/ingest-cvm.js --dry-run --only=BBAS3           # investiga um ticker
FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/ingest-cvm.js --gravar
```

O workflow roda o dry-run **antes** de gravar, mesmo no agendamento: se o layout
mudou, o relatório mostra qual coluna sumiu e o passo de gravação nem chega a
correr.

Ações **não** precisam de cadastro manual: o universo vem do FCA. Para
acrescentar um FII, basta o ticker em `scripts/lib/mapa-cvm.json` — o vínculo
com o fundo é resolvido pelo código publicado no informe, e o casamento é
reimpresso a cada execução para poder ser revisado.

### `GET /api/market?op=ranking&lente=renda` — quais ativos, decidido por dado

Auth: Firebase Bearer. Cache: `marketRanking/{lente}_{topN}`, TTL 12h, aquecido
pelo cron.

Antes, o universo de candidatos era a carteira modelo publicada no painel: um
humano escolhia **quais** ativos entravam e o motor só decidia **quanto** em
cada um. Lista escrita à mão tem dois defeitos que disciplina não resolve —
envelhece sem avisar e limita o universo ao que quem escreveu já conhecia. O
sintoma real: a lista padrão pedia `Tesouro Selic 2027`; quando o título saiu da
oferta, a classe inteira deixou de pontuar e nada na tela dizia por quê.

Agora o universo vem do dado:

| Classe     | De onde saem os candidatos                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ações      | **FCA da CVM** — `fca_cia_aberta_valor_mobiliario` declara o código de negociação de cada companhia. É o vínculo oficial ticker ↔ CNPJ |
| FIIs       | Informe Mensal da CVM, casado por nome com o cadastro de fundos                                                                        |
| Renda fixa | Oferta corrente do Tesouro Direto — dinâmica por natureza                                                                              |
| Cripto     | Alcance da integração com a CoinGecko                                                                                                  |

**Duas passagens de pontuação, de propósito:**

1. **No servidor**, sobre o universo inteiro, para gerar a lista curta;
2. **No cliente**, que busca cotação só dos selecionados e re-pontua com P/L,
   P/VP e proventos.

Fazer tudo no servidor exigiria cotação de centenas de tickers a cada cálculo;
fazer tudo no cliente exigiria baixar o universo inteiro para o browser. A
primeira passagem é peneira, a segunda é a nota que o utilizador vê.

Para a peneira não ficar cega no pilar que mais importa para a lente "Valor", a
ingestão semanal **também busca cotação** de todo o universo e grava a contagem
de ações implícita no lucro por ação — é o par preço × ações que faz existir
P/L, P/VP e EV/EBITDA sem fonte paga.

**Corte de investibilidade.** Não é julgamento sobre a empresa: é que recomendar
o que o cliente não consegue vender é pior do que não recomendar.

| Filtro   | Regra                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------- |
| Porte    | patrimônio líquido (da DFP) abaixo de R$ 300M sai                                                  |
| Liquidez | abaixo de R$ 1M/dia em ações, R$ 200 mil em FIIs                                                   |
| Lastro   | ativo que não pontua não entra na lista curta — não faz sentido gastar uma chamada de cotação nele |

Cada corte é **contado e devolvido** na resposta. Universo que encolhe em
silêncio é impossível de depurar em produção, e a tela mostra "412 ativos
analisados, 245 fora do corte".

A carteira do consultor não desapareceu: virou o modo **"Carteira do
consultor"**, ao lado de **"Todo o mercado"** (padrão). Há contexto em que um
humano no circuito é desejável — mas deixou de ser o único caminho.

### `GET /api/market?op=diagnostico&ticker=BBAS3` — por que este ativo não pontua

Auth: Firebase Bearer. Não escreve nada.

O sintoma "dados insuficientes" é idêntico para sete causas que vivem em
camadas diferentes: universo vazio, corte de investibilidade, fonte que falhou
inteira, fonte que respondeu sem campos, composição que apagou dado, unidade
trocada, cliente que não pediu o ticker. Três rodadas de investigação se
perderam nessa ambiguidade — cada uma foi um palpite, um deploy e uma espera.

Um pedido responde qual camada quebrou:

```jsonc
{
  "documento": { "existe": false, "ramos": [] },
  "fontes": {
    "brapiFundamentos": { "ok": false, "erro": "brapi_401: plano nao permite" },
    "brapiCotacao": { "ok": true, "preco": 28.5, "marketCap": 160000000000 },
    "yahoo": { "ok": true, "cobertura": 0.88 },
  },
  "score": { "valor": 88, "temLastro": true, "cobertura": 0.88 },
  "veredito": "OK — pontua 88/100 com cobertura de 88%.",
}
```

O `veredito` nomeia o elo partido. O protocolo de leitura está em
`.claude/skills/diagnostico-motor-carteira/SKILL.md`, que é uma skill do
projeto e dispara sozinha quando alguém relatar que o motor não pontua.

**Regra que essa investigação deixou:** toda fonte que falha degrada para a
versão mais simples dela e **nunca deixa o ticker sem registo**. A chamada de
fundamentos da BRAPI exige plano pago; sem token responde 401, e a versão
anterior lançava — o ticker ficava sem documento nenhum e perdia-se até o
preço, que a chamada sem parâmetros devolve de graça. Na tela isso aparecia
como um card **sem linha de procedência**, indistinguível de "a fonte
respondeu sem os campos".

Hoje esses dois estados são visualmente distintos, e a ausência de procedência
é o sinal mais informativo da tela.

### Cotação sem cadastro nenhum

A BRAPI passou a exigir token até na chamada simples. Como o produto não pode
depender de um cadastro, a escolha da via vive num ponto único
(`fetchCotacoesMercado`) e é automática:

| `BRAPI_TOKEN` | Via usada            | Custo                          |
| ------------- | -------------------- | ------------------------------ |
| definido      | BRAPI                | 50 ativos por pedido           |
| ausente       | **Yahoo `v8/chart`** | 1 pedido por ativo, mais lento |

O `v8/chart` **não pede token, cookie nem crumb** — é outro endpoint do
`quoteSummary`, que é o protegido e devolve 429 de IP partilhado. O projeto já
o usava para o histórico da simulação, o que prova o caminho de rede.

No dia em que houver token, definir a variável é a única mudança necessária.

**O que ainda depende do job:** o `v8/chart` não devolve valor de mercado. Ele
é reconstruído como preço × ações, com a contagem de ações vindo do lucro por
ação que a ingestão extrai da DRE — ver "Valor de mercado sem fonte paga".
Preencher no request seria inventar.

### `GET /api/market?op=indicadores`

Auth: Firebase Bearer. Cache: `marketIndicadores/bcb`, TTL 6h, aquecido pelo cron
noturno já existente.

Selic, CDI e IPCA vinham de constantes no código (`CDI: 0.1325`). A Selic muda
várias vezes por ano e dela sai a taxa real de todo título do Tesouro — uma
constante desatualizada erra em silêncio, sem nada na tela que denuncie.

O risco de trocar constante por série do SGS é específico: **código de série
errado não dá erro, dá número válido de outra coisa**. Por isso cada indicador
tem lista de séries candidatas e cada candidata é validada contra uma faixa
plausível; séries diárias são anualizadas em base 252 antes da checagem. Uma
"Selic" de 0,05% é recusada e o motor passa à próxima.

A inflação vem da **mediana do Focus**, não do IPCA passado: para deflacionar a
taxa de um título que vence no futuro, expectativa é o número certo.

Degradação em camadas, nenhuma silenciosa:

| Falha                  | Resposta                                      |
| ---------------------- | --------------------------------------------- |
| CDI indisponível       | derivado da Selic, origem `Derivado da Selic` |
| Focus indisponível     | cai para o IPCA de 12 meses                   |
| BCB inteiro fora do ar | mantém a constante, marca `degradado`         |

Este endpoint **nunca responde erro** — quem o chama precisa de um número para
continuar a conta. A tela mostra a origem de cada valor, ou avisa que é premissa
de reserva.

### `GET /api/market?op=rendafixa`

Auth: Firebase Bearer. Cache: `marketRendaFixa/tesouroDireto`, TTL 12h, com
fallback para cache vencido se a fonte cair.

Sem esta op, a classe com maior peso na carteira de um Conservador seria a única
sem dado real. A fonte é o JSON público que alimenta o site do Tesouro Direto
(o CSV do Tesouro Transparente traz a série histórica inteira e é inviável numa
serverless).

A taxa publicada significa coisas diferentes conforme o título, e o motor precisa
de tudo na mesma régua:

| Tipo      | O que a taxa publicada é | Conversão                                   |
| --------- | ------------------------ | ------------------------------------------- |
| IPCA+     | já é a taxa **real**     | nominal = `(1+taxa)(1+IPCA) - 1`            |
| Prefixado | nominal                  | real = `(1+taxa)/(1+IPCA) - 1`              |
| Selic     | **spread** sobre a Selic | nominal = `Selic + taxa`, depois deflaciona |

Ler o spread do Tesouro Selic (`0,15`) como taxa cheia daria um título rendendo
0,15% ao ano. As premissas de CDI/IPCA vêm de `PREMISSAS_ANUAIS`, as mesmas
curvas sintéticas da simulação histórica da aba — divergir faria a mesma tela
mostrar dois CDIs diferentes.

> ⚠️ O formato daquele endpoint já mudou antes (`TrsrBdTradgList` / `TrsrBd`).
> `parseTesouroResposta` procura cada campo em mais de um caminho e descarta
> item malformado sozinho, mas **vale conferir a resposta real no primeiro
> deploy** — o mapeamento não foi validado contra a fonte ao vivo.

---

## 2. Critérios de análise

Cinco pilares, com métricas e faixas próprias por classe
(`MOTOR_CRITERIOS`). As faixas são calibradas para o mercado brasileiro: P/L 10 é
barato aqui e caro em bolsa madura; DY de 8% é normal na B3 e seria anomalia lá
fora.

Cada métrica é uma curva de pontos `[valor, nota]`, interpolada linearmente e
saturada nas pontas. Uma curva só cobre os três formatos necessários:

- **menor é melhor** — P/L, dívida (notas decrescentes);
- **maior é melhor** — ROE, liquidez (notas crescentes);
- **faixa ideal** — DY, payout (sobe e depois desce).

O terceiro caso é o motivo de não usar min/max simples: DY de 25% quase nunca é
bom sinal — costuma ser dividendo extraordinário ou preço em queda livre — e uma
régua monotônica premiaria justamente esse ativo. Pelo mesmo motivo, P/L negativo
não vira "barato": cai para a nota de prejuízo.

| Classe     | Valuation                   | Dividendos                            | Crescimento                        | Endividamento                                 | Qualidade                                     |
| ---------- | --------------------------- | ------------------------------------- | ---------------------------------- | --------------------------------------------- | --------------------------------------------- |
| Ação       | P/L, P/VP, EV/EBITDA        | DY, DY médio 5a, payout, anos pagando | CAGR receita e lucro               | Dív.Líq/EBITDA, Dív.Líq/PL, liquidez corrente | ROE, ROIC, margem líquida, liquidez diária    |
| FII        | P/VP                        | DY, DY médio 36m, consistência        | crescimento do dividendo, ocupação | alavancagem/LTV                               | liquidez, patrimônio, cotistas, nº de imóveis |
| Cripto     | —                           | —                                     | retorno 12m                        | —                                             | capitalização, volume, anos, volatilidade     |
| Renda fixa | taxa real, prêmio sobre CDI | paga cupom                            | —                                  | solidez do emissor                            | prazo de resgate, isenção de IR               |

Em cripto, valuation e dividendos ficam **vazios de propósito** — não há lucro
nem distribuição. O motor redistribui o peso desses pilares entre os que têm
dado, em vez de fingir uma nota 5. Em renda fixa os cinco nomes são mantidos com
significado adaptado ("endividamento" = risco do emissor) para a tela desenhar um
card só.

### Lentes

Uma lente é um **vetor de peso sobre os pilares** — não uma carteira de terceiro.
A ideia é traduzir princípios de análise que circulam publicamente em números
auditáveis:

| Lente        | Peso dominante                     | Princípio traduzido                                                                               |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `equilibrio` | parelho                            | nenhum pilar decide sozinho                                                                       |
| `renda`      | Dividendos 2,2 · Endividamento 1,5 | fluxo durável vale mais que dividendo alto de um ano; setor perene reduz o risco de a renda secar |
| `qualidade`  | Qualidade 2,0 · Crescimento 1,8    | ROE/ROIC altos e constantes indicam vantagem competitiva                                          |
| `valor`      | Valuation 2,2 · Endividamento 1,6  | o retorno começa a ser definido no preço de compra                                                |

A lente `renda` dá bônus de 4 pontos a setores perenes (banco, energia,
saneamento, seguro, telecom).

**Nenhuma lente reproduz recomendação de casa de análise nem tem endosso de quem
quer que seja.** Quem escolhe os ativos do universo continua sendo a carteira
modelo publicada no painel do consultor. A lente padrão sai do objetivo declarado
no questionário, e o utilizador pode trocar.

Os `filtros` da lente (DY mínimo, ROE mínimo) **não excluem** o ativo: marcam
`elegivel: false` e viram alerta na tela. Ativo que some em silêncio ninguém
audita.

---

## 3. Score

```
score = Σ(nota do pilar × peso da lente) / Σ(pesos com dado) × 10
```

Pilar sem nenhuma métrica preenchida é descartado e os pesos renormalizam.

### Abaixo de 30% de cobertura, não há score

Esta é a regra mais importante do motor e vale a pena entender por quê.

A versão anterior encolhia o score na direção da média quando faltava dado. Com
os indicadores em falta, o resultado medido era:

```
1 BBAS3   score 29 | cobertura 0%
2 BTLG11  score 25 | cobertura 0%
3 MGLU3   score 25 | cobertura 0%
...
```

Quatro pontos de amplitude, desempate alfabético do ticker fazendo as vezes de
análise, e o único diferenciador real era o bônus setorial. Pior do que inútil:
na tela, **25/100 lê-se como veredito sobre o ativo**, quando é veredito sobre
os nossos dados.

Hoje o motor devolve `score: null`, `temLastro: false` e `faltando` — a lista,
por pilar, dos indicadores ausentes. A tela mostra "faltam indicadores para
pontuar" com os nomes, o selo é a ausência do número (não um número cinzento) e
o ativo não ocupa posição no ranking.

As consequências propagam:

- o ranking manda os sem lastro para o fim **em bloco** (subtrair `null` daria
  `NaN` e o sort devolveria a ordem de entrada — a pior falha possível num ranking);
- havendo ativo pontuado na classe, o sem lastro **não recebe aporte**: escolher
  no escuro tendo alternativa avaliada não se justifica;
- não havendo nenhum pontuado, a divisão sai igual e é rotulada
  `modo: 'igualitario'`, com aviso de que **não é resultado de análise**;
- o bônus setorial não ressuscita ativo sem lastro.

**Encolhimento por cobertura** continua a valer na faixa entre 30% e 60%, onde há
dado ainda que parcial. Um ativo avaliado por duas métricas não pode liderar o
ranking em cima de um avaliado por quinze:

```
penal = clamp((0.6 - cobertura) / 0.6, 0, 0.5)
score = score + (50 - score) × penal
```

A saída traz `pilares` (nota, peso, cobertura e cada métrica com valor e nota),
`cobertura`, `confianca` (alta/média/insuficiente), `faltando`, `alertas`,
`elegivel` e a procedência (`fonte`, `fonteRotulo`, `dataReferencia`,
`atualizadoEm`). A tela desenha as cinco barras a partir disso — pilar sem dado
vira barra **vazia**, não barra zerada: zero lê-se como "nota zero", vazio lê-se
como "sem informação".

### Procedência

Indicador sem fonte e data é opinião. Cada card mostra
`DFP 2025 · CVM + cotação · ref. 31/dez/2025 · lido há 3 dias`, e acima de 45
dias o dado é marcado como vencido. É a diferença entre "confie em mim" e
"confira você mesmo" — e é a segunda que sustenta um produto pago.

---

## 4. Carteira personalizada

### Alocação macro

Parte da carteira modelo publicada (`config/carteiraModelo`) e aplica ajustes:

1. **tilt por objetivo** — renda passiva empurra FII; crescimento empurra ação;
2. **tilt por prazo** — prazo curto empurra renda fixa;
3. **cerca por perfil** (`MOTOR_LIMITES_PERFIL`) — Conservador nunca recebe
   cripto, por mais longo que seja o prazo;
4. **piso de RF do prazo curto** — dinheiro de 1 ano vai para ≥60% em RF, por
   mais arrojado que seja o investidor;
5. normalização iterativa para fechar em 100 respeitando mínimos e máximos.

Normalizar e depois cortar quebra a soma; cortar e depois normalizar estoura o
limite. `motorNormalizarComLimites` itera: reescala, corta, e devolve a sobra só
para quem ainda tem folga na direção certa.

### Divisão do aporte entre classes

Com patrimônio conhecido, o motor **não** usa a proporção-alvo direto: calcula
quanto falta em cada classe para o total (patrimônio + aporte) bater no alvo e
manda o dinheiro para os buracos. É rebalanceamento por aporte — chega no alvo
sem vender nada e sem gerar imposto.

O patrimônio vem da aba Meu Patrimônio quando existe (`renda_fixa`, `reserva` e
`previdência` → RF; `ações`, `BDRs` e `ETFs` → ação; `fiis` → FII; `cripto` →
cripto). O campo do questionário só entra como substituto.

### Escolha dos ativos dentro da classe

Peso proporcional ao score, mas **não ao score cru**: entre 80 e 60 a diferença
real de convicção é maior do que 80/60 sugere, porque a escala não começa em zero
(score 40 é "não compraria"). Por isso desconta o piso antes de elevar ao
expoente:

```
peso_i ∝ max(score_i - 40, 1) ^ 1.5
```

Depois: teto de concentração por classe, corte de fatias irrelevantes (que só
viram custo de corretagem) e `topN` limitado pelo tamanho do aporte — com R$ 200
em ações, dividir em 6 nomes dá R$ 33 cada e não compra nada.

> O teto precisa ser **factível**: com 3 ativos e teto de 30%, nenhuma combinação
> soma 100% e o resultado degenera para peso igual — exatamente o que o score
> existe para evitar. O piso `1.6 / n` deixa o primeiro colocado ficar até 60%
> acima do peso igual quando a classe tem poucos nomes.

### Conversão em ordens

| Classe     | Unidade     | Regra                                                   |
| ---------- | ----------- | ------------------------------------------------------- |
| Ação, FII  | inteira     | arredonda para baixo, depois passada gulosa com o troco |
| Cripto     | fracionária | valor exato                                             |
| Renda fixa | —           | valor exato                                             |

A passada gulosa gasta o troco em duas preferências: primeiro quem ainda está
abaixo do próprio alvo (maior buraco primeiro, para convergir aos pesos); depois,
se todos já bateram o alvo mas ainda dá para comprar, o melhor colocado do
ranking. Sem a segunda preferência, sobrava caixa parado com ativo barato
disponível. A sobra final fica menor que o ativo mais barato da classe e é
carregada para o próximo aporte.

---

## Testes

```bash
npm test                                        # tudo (555)
node --test test/motor-carteira.test.js         # score e alocação (57)
node --test test/market-fundamentals.test.js    # normalização e composição (49)
node --test test/cvm-parser.test.js             # ZIP, CSV e indicadores da CVM (29)
node --test test/carteira-motor-render.test.js  # montagem do HTML (29)
```

Nenhum teste toca a rede. Os do BCB usam `fetch` dublado; os da CVM operam sobre
fixtures no formato documentado, incluindo um ZIP construído em memória.

O teste de render existe porque estas funções montam HTML por concatenação: um
nome de campo errado no meio de um template não quebra nada — imprime
`undefined` na tela do cliente e só aparece em produção. Há uma asserção
específica para isso.

---

## Validação pendente

Os endpoints da CVM, do BCB e do Tesouro **não puderam ser exercitados contra a
fonte ao vivo** durante o desenvolvimento (o ambiente não tinha acesso a eles).
O código é defensivo em todos os pontos onde o formato pode divergir, e cada
defesa tem teste — mas a primeira execução real precisa de revisão humana:

1. `node scripts/ingest-cvm.js --dry-run --anos=1` — confira a lista
   `ticker → empresa` e os campos reportados como ausentes.
2. `GET /api/market?op=indicadores` — confira se `degradado` é `false` e se as
   séries nomeadas em `origem` são as corretas.
3. `GET /api/market?op=rendafixa` — confira se os títulos vieram e se
   `taxaRealAnual` bate com o site do Tesouro.

Onde algo divergir, o ajuste é sempre numa lista de apelidos ou de códigos
candidatos, não na lógica.

Enquanto isso não acontece, o produto continua utilizável: classe sem candidatos
no ranking cai para a carteira do consultor, com aviso na tela. Sem esse resgate,
a classe sumiria e o aporte dela viraria sobra de caixa em silêncio — num aporte
de R$ 2.000 com alocação 27/38/35, R$ 1.460 ficavam sem destino.

---

## Limitações conhecidas

- **DY médio** usa o preço de hoje sobre o dividendo médio dos anos passados. O
  correto seria o preço de cada época, que a fonte não devolve junto do provento.
  Serve para comparar ativos entre si na mesma data, que é o uso no ranking.
- **LTV/alavancagem de FII** não vem no Informe Mensal. Patrimônio, cotistas e
  vacância vêm; a alavancagem fica vazia até alguém a fornecer pela carteira
  modelo.
- **Volatilidade de cripto**: a métrica existe no motor, a fonte atual não a
  fornece. Dá para calcular de `/coins/{id}/market_chart` (gratuito) numa próxima
  iteração.
- **CDB/LCI/debêntures** não têm fonte pública de taxa — são ofertas comerciais
  por corretora. Só o Tesouro Direto é integrado. O caminho honesto é o consultor
  cadastrá-los na carteira modelo com taxa, prazo e cobertura do FGC; o motor já
  pontua a partir desses campos.
- **Empresas fora do mapa** (`scripts/lib/mapa-cvm.json`) não recebem dado da
  CVM. Acrescentar é uma linha, mas não é automático — e é de propósito: o
  casamento por nome precisa de revisão humana.
