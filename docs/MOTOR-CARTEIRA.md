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

| Classe           | Fonte primária                           | Complemento                                       |
| ---------------- | ---------------------------------------- | ------------------------------------------------- |
| Ações            | **CVM — DFP** (job de ingestão)          | BRAPI: preço, valor de mercado, volume, proventos |
| FIIs             | **CVM — Informe Mensal**                 | BRAPI: preço, proventos                           |
| ETFs, BDRs       | BRAPI                                    | —                                                 |
| Criptos          | CoinGecko `/coins/markets`               | —                                                 |
| Renda fixa       | **Tesouro Direto** (`op=rendafixa`)      | BCB, para converter a taxa                        |
| Selic, CDI, IPCA | **BCB — SGS + Focus** (`op=indicadores`) | —                                                 |

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

Regras da composição:

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

1. baixa `cad_cia_aberta.csv` e casa cada ticker do mapa com a empresa **pelo
   nome**, não por código decorado;
2. baixa as DFP dos últimos N exercícios (`BPA_con`, `BPP_con`, `DRE_con`,
   `DFC_MI_con`);
3. extrai as contas do plano padrão e calcula ROE, ROIC, margens, liquidez
   corrente, dívida líquida/EBITDA, dívida líquida/PL e CAGR de receita e lucro;
4. baixa o Informe Mensal de FII e extrai patrimônio, cotistas e **vacância** —
   o dado que nenhuma API gratuita entrega;
5. grava no ramo `cvm` de `marketFundamentals/{TICKER}`.

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

**Operação.** O primeiro uso deve ser `--dry-run`, e o relatório revisado por
uma pessoa:

```bash
node scripts/ingest-cvm.js --dry-run --anos=1        # confere layout e casamentos
node scripts/ingest-cvm.js --dry-run --only=BBAS3    # investiga um ticker
FIREBASE_SERVICE_ACCOUNT_BASE64=... node scripts/ingest-cvm.js --gravar
```

O workflow roda o dry-run **antes** de gravar, mesmo no agendamento: se o layout
mudou, o relatório mostra qual coluna sumiu e o passo de gravação nem chega a
correr.

Para acrescentar um ativo, edite `scripts/lib/mapa-cvm.json` com o nome pelo qual
ele aparece no cadastro da CVM. O mapa guarda **nome**, não `CD_CVM`: código
decorado num arquivo envelhece e ninguém confere; o casamento por nome é
reimpresso a cada execução, para poder ser revisado.

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
