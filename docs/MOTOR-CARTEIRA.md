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

Duas sub-ops novas no endpoint único de mercado — o Vercel Hobby limita a 12
functions, então tudo entra em `api/market.js` via `?op=`.

### `GET /api/market?op=fundamentals&tickers=BBAS3,MXRF11,BTC`

Auth: Firebase Bearer. Cache: `marketFundamentals/{TICKER}` no Firestore, TTL 24h.

| Classe                  | Fonte                                                          | O que chega                               |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Ações, FIIs, ETFs, BDRs | BRAPI `/quote` com `fundamental=true&dividends=true&modules=…` | Preço, múltiplos, balanço, DRE, proventos |
| Criptos                 | CoinGecko `/coins/markets`                                     | Preço, capitalização, volume, retorno 12m |

O trabalho real não é buscar, é **normalizar**. A BRAPI devolve razão num campo
(`returnOnEquity: 0.185`) e percentagem em outro (`debtToEquity: 45.3`), e vários
indicadores que o motor usa não existem em campo nenhum:

| Indicador do motor              | Como é obtido                                                             |
| ------------------------------- | ------------------------------------------------------------------------- |
| `dividaLiquidaEbitda`           | `(totalDebt - totalCash) / ebitda`                                        |
| `dividaLiquidaPl`               | dívida líquida ÷ (`marketCap / priceToBook`); fallback `debtToEquity/100` |
| `payout`                        | dividendos dos últimos 12 meses ÷ LPA                                     |
| `dy`, `dyMedio5a`, `dyMedio36m` | janelas sobre `cashDividends`                                             |
| `consistenciaDividendos`        | **meses distintos** com pagamento nos últimos 24                          |
| `cagrReceita5a`, `cagrLucro5a`  | CAGR do primeiro ao último exercício do `incomeStatementHistory`          |
| `liquidezDiaria`                | `regularMarketVolume × preço`                                             |

Cada conversão dessas está coberta em `test/market-fundamentals.test.js` — um
fator 100 trocado não quebra nada, só faz o ranking inteiro mentir.

**Cobertura parcial é o caso normal.** O plano grátis da BRAPI não devolve os
módulos financeiros: os campos chegam `null`, a resposta traz `cobertura`, e o
motor lida com isso (ver §3). Campo ausente nunca vira zero.

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
Depois entram dois ajustes:

**Encolhimento por cobertura.** Um ativo avaliado por duas métricas não pode
liderar o ranking em cima de um avaliado por quinze. Conforme a cobertura cai
abaixo de 60%, o score é puxado na direção de 50:

```
penal = clamp((0.6 - cobertura) / 0.6, 0, 0.5)
score = score + (50 - score) × penal
```

**Bônus setorial**, só na lente que declara setores preferidos.

A saída traz `pilares` (nota, peso, cobertura e cada métrica com valor e nota),
`cobertura`, `confianca` (alta/média/baixa), `alertas` e `elegivel`. A tela
desenha as cinco barras a partir disso — pilar sem dado vira barra **vazia**, não
barra zerada: zero lê-se como "nota zero", vazio lê-se como "sem informação".

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
npm test                                   # tudo
node --test test/motor-carteira.test.js         # score e alocação (48)
node --test test/market-fundamentals.test.js    # normalização dos dados (29)
node --test test/carteira-motor-render.test.js  # montagem do HTML (18)
```

O teste de render existe porque estas funções montam HTML por concatenação: um
nome de campo errado no meio de um template não quebra nada — imprime
`undefined` na tela do cliente e só aparece em produção. Há uma asserção
específica para isso.

---

## Limitações conhecidas

- **ROIC** não é preenchido pela API. A BRAPI não o expõe e usar ROA no lugar
  seria outro indicador com o nome errado. O pilar Qualidade funciona com as
  outras três métricas.
- **DY médio** usa o preço de hoje sobre o dividendo médio dos anos passados. O
  correto seria o preço de cada época, que a fonte não devolve junto do provento.
  Serve para comparar ativos entre si na mesma data, que é o uso no ranking.
- **Vacância, LTV e nº de cotistas de FII** não vêm da BRAPI. As métricas existem
  no motor e são pontuadas quando alguém as fornece (carteira modelo), mas hoje
  chegam vazias pela API.
- **Volatilidade de cripto** idem: a métrica existe, a fonte atual não a fornece.
- **CDB/LCI/debêntures** não têm fonte pública de taxa. Só o Tesouro Direto é
  integrado; outros títulos de RF entram sem indicadores e caem para score neutro
  com confiança baixa.
