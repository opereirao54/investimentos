---
name: diagnostico-motor-carteira
description: Protocolo para diagnosticar e corrigir o motor da Carteira Recomendada quando ele não pontua ativos — "só pontuou cripto", "as ações aparecem com dados insuficientes", "score sumiu", "a classe ficou vazia", "o plano não distribuiu o aporte todo", "o ranking não trouxe nada". Localiza com evidência o elo exato da cadeia (universo → ranking → fundamentos → fonte externa → composição → score → tela) ANTES de mudar código. Use sempre que um ativo ou uma classe inteira não receber score, quando a tela mostrar "dados insuficientes" ou "sem alocação nesta classe", quando o aporte não for distribuído por completo, quando os indicadores parecerem errados por fator de 100, ou quando uma correção anterior no motor não tiver resolvido o sintoma. Use também para investigar procedência ausente ("o card não mostra a fonte") e diferença entre o que o servidor devolve e o que a tela desenha.
---

# Diagnóstico do Motor da Carteira Recomendada

**Princípio central: score ausente quase nunca é bug de cálculo de score.** É a cadeia de dados quebrada em algum ponto antes do cálculo. O motor recusar-se a pontuar é o comportamento _correto_ quando o dado não chegou — a regra `MOTOR_COBERTURA_MINIMA` existe exatamente para isso. Corrigir o motor quando o problema é a fonte só apaga o aviso e faz o produto mentir.

**Por que este tipo de bug resiste a várias tentativas:** o sintoma na tela ("dados insuficientes") é o mesmo para sete causas diferentes, que vivem em camadas diferentes — descoberta do universo, ranking no servidor, endpoint de fundamentos, API de terceiro, composição das fontes, limiar do motor, render. Ler o código com mais atenção não distingue as sete. Só **evidência de runtime** distingue. E cada chute contamina a cena: adiciona uma fonte, muda um limiar, e o diagnóstico seguinte fica mais difícil que o primeiro.

**Regra de ouro: nenhuma correção antes de completar as Etapas 0 a 2.** Se pedirem "arruma logo", explique em uma linha por que o diagnóstico é mais rápido que a quarta tentativa de chute — e siga o protocolo.

Conduza o trabalho em português brasileiro.

---

## Etapa 0 — Ler o sintoma com precisão

Antes de qualquer coisa, extraia da descrição (ou da captura de tela) **qual dos estados** está acontecendo. Eles parecem iguais e têm causas opostas:

| O que aparece na tela                                            | O que isso significa                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Card com selo `—` e "FALTAM INDICADORES PARA PONTUAR"            | O ativo chegou ao motor, mas com cobertura abaixo do mínimo              |
| Card **sem linha de procedência** (sem "Fonte · lido há N dias") | **O endpoint não devolveu nada para este ticker.** Nem preço. Suspeito 3 |
| Card com procedência mas sem score                               | A fonte respondeu, mas sem os indicadores. Suspeito 4                    |
| "Sem alocação nesta classe"                                      | A classe ficou sem candidatos. Suspeito 1                                |
| Aviso "carteira do consultor como reserva"                       | O ranking veio vazio para a classe — esperado antes da ingestão          |
| Score existe mas parece absurdo (ROE 4000%)                      | Conversão de unidade. Suspeito 6                                         |

A **ausência da linha de procedência é o sinal mais informativo da tela.** Um ativo que passou pelo `op=fundamentals` sempre volta com `fonte`, nem que seja só cotação. Se não há procedência, o ticker voltou na lista `indisponiveis` — e aí o problema está no servidor ou na fonte externa, nunca no motor.

## Etapa 1 — O teste que divide o problema ao meio

Um pedido, e a cadeia parte em duas:

```
GET /api/market?op=diagnostico&ticker=BBAS3
```

(Precisa do Bearer do Firebase. No browser autenticado, a aba Rede do DevTools mostra a resposta.)

Ele responde, por camada, **o que cada fonte devolveu e por que falhou**. Leia nesta ordem:

1. `documento` — existe o doc em `marketFundamentals/{TICKER}`? Quais ramos (`cvm`, `yahoo`, `mercado`)?
2. `fontes` — o que cada fonte respondeu AGORA, com o erro literal.
3. `composto` — o resultado da junção dos ramos.
4. `score` — o que o motor faria com isso, e a cobertura obtida.

O primeiro campo vazio na sequência é o elo partido. Não continue a ler depois dele.

Se `op=diagnostico` não existir ainda no deploy, o equivalente mínimo é:

```
GET /api/market?op=fundamentals&tickers=BBAS3
```

e olhar `indisponiveis` e `erros`. Ticker dentro de `indisponiveis` já responde a Etapa 1.

## Etapa 2 — Suspeitos, do mais provável ao menos

### S1 — Universo vazio para a classe

`op=ranking` devolve `classes.acao.itens: []`. Normal antes de a ingestão da CVM gravar. **Verificação:** `op=ranking&lente=equilibrio` → olhar `universo` e `excluidos`. `universo: 0` significa `marketFundamentals` vazia — o job nunca rodou. `universo` alto com `excluidos.porte_abaixo_do_piso` alto significa que o corte está agressivo demais.

### S2 — Cortes de investibilidade engolindo tudo

`PATRIMONIO_MINIMO` e `LIQUIDEZ_MINIMA` em `api/market.js`. Um piso de liquidez aplicado a um ativo cuja cotação ainda não foi buscada elimina candidato válido. **A regra correta é: filtro só se aplica quando o dado existe.**

### S3 — Fonte que falha inteira leva junto o que funcionava ⚠️

**O erro mais caro desta base, e já aconteceu.** `fetchBrapiFundamentals` pedia `modules=` e `fundamental=true`, que exigem plano pago. Sem token, a resposta era 401, a função lançava, e o ticker ficava **sem documento nenhum** — perdia-se até o preço, que a chamada simples devolveria de graça.

Sintoma: card sem linha de procedência. **Regra:** toda fonte que falha tem de degradar para a versão mais simples dela, e nunca deixar o ticker sem registo. Um documento com `fonte: 'indisponivel'` e o motivo é infinitamente melhor que ausência de documento — a tela consegue explicar o primeiro e não consegue explicar o segundo.

### S3b — 401 por token ausente ≠ fonte fora do ar ⚠️

Caso real, encontrado com `op=diagnostico`:

```
brapi_fundamentos: brapi_401 {"code":"MISSING_TOKEN"}
brapi_cotacao:     brapi_401 {"code":"MISSING_TOKEN"}
yahoo: 429 (sete vezes)
```

Duas causas distintas na mesma resposta, e **só a primeira tem conserto do
nosso lado**. Sempre separe:

| Erro                  | Natureza               | Ação                                                                                           |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 401 / `MISSING_TOKEN` | Configuração           | Definir a variável de ambiente. `diagnosticarErrosDeFonte` traduz isto em instrução            |
| 429                   | Limite de IP de saída  | Não há o que configurar. Mover o trabalho para o job do GitHub Actions, cujo IP não é limitado |
| Timeout / DNS         | Indisponibilidade real | Esperar e degradar                                                                             |

**Verifique sempre o alcance.** A mesma `fetchBrapi` serve `op=quote` (aba
Meu Patrimônio, que cai para preço médio em silêncio) e o cron de aquecimento.
Um token em falta não quebra só a Carteira Recomendada — quebra três coisas, e
duas delas sem nenhum sintoma visível.

**429 em série é diferente de 429 pontual.** Sete tentativas com sete 429
significa IP limitado, não ticker problemático. Insistir gasta o orçamento e
aprofunda o bloqueio: desista após dois seguidos e reporte esse estado à parte.

### S4 — Fonte responde, mas sem os campos

Plano grátis que devolve 200 com metade dos campos nulos. Cobertura fica abaixo de `MOTOR_COBERTURA_MINIMA` (0,3) e o motor recusa pontuar — **corretamente**. A correção é arranjar dado, nunca baixar o limiar.

### S5 — Composição apagando dado

Três ramos (`cvm`, `yahoo`, `mercado`) no mesmo documento. Um `merge: true` plano faz o `null` de uma fonte apagar o valor de outra. Ver `comporFundamentos`. **Verificação:** no diagnóstico, comparar `documento.cvm.roe` com `composto.roe`.

### S5b — Nota parcial com cara de nota completa

O score global já recusa pontuar sem lastro, mas **o mesmo erro reaparece uma
camada abaixo**: um pilar calculado sobre 1 dos seus 4 indicadores desenha
barra cheia, idêntica à de um pilar completo. Visto na tela: `Qualidade 10,0`
em barra verde ao lado de "DADOS INSUFICIENTES", apoiado só na liquidez
diária, com ROE, ROIC e margem líquida ausentes.

**Verificação:** compare `pilares.X.nota` com `pilares.X.cobertura`, ou conte
quantas `metricas` têm `nota !== null`.

**Regra:** sempre que um número resume vários, a tela precisa mostrar sobre
quantos ele foi calculado. Vale para o score, para o pilar e para qualquer
média futura.

### S5c — Chave de junção que o outro lado não tem ⚠️

**Aconteceu, e custou quatro rodadas de investigação.** O pipeline da CVM
procurava a companhia por `CD_CVM`. O FCA identifica a companhia por
`CNPJ_Companhia` e **nunca teve `CD_CVM`**. Resultado no log:

```
! colunas do FCA não encontradas: cdCvm
FCA 2025: 0 tickers
...
0 companhias com dados neste exercício
```

O arquivo abria, as colunas resolviam, o parse funcionava. **Procurar por uma
identificação que o arquivo não tem devolve zero sem lançar erro nenhum** — e
zero linhas é indistinguível de "não há dados" para quem lê só o total.

O mesmo vale para a forma da chave: CNPJ pontuado vs. cru, `CD_CVM` com e sem
zeros à esquerda. Comparados como texto, separam a companhia dela mesma.

**Verificação:** ao casar zero registos com o arquivo aberto, imprima lado a
lado a chave procurada e uma amostra das chaves que o arquivo realmente tem. Se
os formatos não se parecem, o problema é a chave — não os dados.

**Regra:** junção entre dois arquivos usa a identificação presente nos DOIS, e
normalizada antes de comparar. Quando houver mais de uma candidata, indexe por
todas e tente todas — o custo é um `Map` a mais, e o prémio é não falhar em
silêncio.

### S5d — A busca acha algo, só que a coisa errada ⚠️

**A família de bugs mais cara deste projeto.** Dez instâncias reais, todas
encontradas lendo o log de execução contra dados de verdade:

| sintoma                                       | causa                                                                 | por que passou despercebido                          |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `0 tickers`, `0 companhias`                   | chave de junção que o outro arquivo não tem                           | zero linhas é indistinguível de "não há dados"       |
| `LPA 190,00` (o real é 0,19)                  | escala do arquivo aplicada a uma conta por ação                       | 190 é um número, e números parecem certos            |
| `ROE 43,4%`, `dívLíq/EBITDA 12,49x` num banco | o código `2.03` é outra conta no plano das instituições financeiras   | devolveu valor real, da conta errada                 |
| `ELET3 ações 0,00bi` para PL de 118 bi        | linha de outra natureza vencendo no arquivo de composição do capital  | 0,00bi só chama atenção ao lado do patrimônio        |
| `? MXRF11 MAXI RENDA FIXA CURTO PRAZO…`       | nome casado contra o cadastro de TODOS os fundos, não só os FIIs      | casou — com um fundo de renda fixa                   |
| informe de FII de janeiro lido em agosto      | primeira entrada do ZIP que casa com o prefixo, num ZIP por mês       | números plausíveis, só velhos                        |
| `DY 0,008%/mês` em todo FII                   | campo chamado `Percentual_` que é razão                               | um número, e números parecem certos                  |
| `ELET3 2,92M ações` para 118 bi de patrimônio | escala da quantidade declarada por linha, ignorada                    | BBAS3 saía certo — a escala dele é UNIDADE           |
| `? XPML11 PENINSULA FII`                      | duas classes com a mesma raiz de ISIN, vencedor pela ordem do arquivo | casou, e o nome não parece errado a quem não conhece |
| `GGRC11 ocupação 0` num fundo cheio           | média sobre os 4 imóveis de 228 que preenchem a coluna esparsa        | 0% é um número, e a coluna existe mesmo              |
| `MXRF11 tijolo` num fundo de recebíveis       | regra binária ("tem imóvel") onde a realidade é proporcional          | ele tem mesmo dois imóveis — a regra respondeu certo |
| `ELET3 2,31M ações` para 118 bi de patrimônio | arquivo sem coluna de escala e duas convenções nele                   | 2.307.099 é o que está escrito no arquivo            |
| `tes 0` em TODA companhia                     | o mapa procurava `TESOURARIA`, o arquivo traz `TESOURO`               | zero é o que uma empresa sem tesouraria também tem   |

O padrão: **a busca não falha, ela acerta o alvo errado.** Não há exceção,
não há `null`, não há linha de erro — há um número plausível o suficiente
para ninguém olhar duas vezes.

**Verificação:** cruze o número com uma grandeza pública conhecida. O ROE do
Banco do Brasil é ~20%, não 43%; o patrimônio dele é ~180 bi, não 31 bi.
Um indicador derivado que não fecha com o mundo real é a única evidência
disponível quando o código não reclama.

**Regras que ficam:**

- Identificador presente nos DOIS lados, normalizado antes de comparar.
- Unidade vem do significado da conta, não do metadado do arquivo.
- Antes de aceitar um número derivado, confira-o contra uma grandeza que
  NÃO passou pelo mesmo caminho (o patrimônio confere a contagem de ações;
  o total do grupo confere a soma das folhas).
- Quando o layout tem variantes (planos de conta setoriais), **detecte a
  variante pelos próprios dados** e recuse-se a aplicar o que não vale ali.
  Melhor um travessão do que um EBITDA de banco.
- "Achou um" não é "achou o certo": onde a fonte tem MUITAS linhas por
  chave (um arquivo por mês no ZIP, várias linhas por companhia), diga
  explicitamente qual vence e por qual critério. `find()` devolve a
  primeira do arquivo, que não é critério nenhum.
- Antes de casar por NOME, verifique se o identificador existe. Só se
  recorre a nome quando não há código — e aí o universo precisa ser
  reduzido primeiro, senão o nome não identifica. Melhor ainda: procure o
  código onde ele de facto está (o ISIN do informe de FII carrega a raiz
  do ticker; ninguém precisava escrever a tabela à mão).
- Média sobre subconjunto é pior do que lacuna quando o subconjunto é
  ENVIESADO — e uma coluna esparsa quase sempre o é: quem preenche o campo
  é quem tem algo a declarar. Exija cobertura mínima e imprima-a ao lado
  do número; "ocupação 90%" e "ocupação 90% medida em 2 de 40" são a mesma
  linha sem ela.
- **Regra binária onde a realidade é proporcional** responde certo à
  pergunta errada. "Tem imóvel?" e "o imóvel é o que paga o rendimento?"
  separam-se num fundo de recebíveis com dois imóveis — e é a segunda que
  decide quais indicadores se aplicam. Quando a classificação governa a
  cobertura, ela precisa da FATIA, e a fatia precisa de ir no log ao lado
  do rótulo: sem ela os dois "tijolo" são indistinguíveis.
- **Coluna com nome quase certo falha calada.** O mapa procurava
  `QT_ACAO_ORDIN_TESOURARIA`; o arquivo traz `QT_ACAO_ORDIN_TESOURO`. Não
  resolver uma coluna opcional devolve zero, e zero é o que uma companhia
  sem tesouraria também tem. **Nomeie no log TODA coluna que não resolveu**,
  nunca só a que se está a investigar naquele dia.
- **Fixture mais fácil que a realidade não testa a realidade.** O cabeçalho
  inventado da composição do capital tinha escala, tinha `CD_CVM` e
  chamava a tesouraria de `TESOURARIA` — nenhum dos três existe no arquivo
  publicado. A suíte passava enquanto a produção falhava. Ao descobrir um
  layout real pelo log, **copie-o para o fixture** em vez de descrever o
  que se imagina que ele seja.
- **Metadado ausente não autoriza supor a unidade — mas o cruzamento
  decide.** O arquivo da CVM não declara escala nenhuma e as companhias
  usam convenções diferentes no MESMO arquivo. Quem arbitra é uma grandeza
  independente (o patrimônio). E a correção tem de ser de **mão única**:
  só se corrige a ponta em que a absurdez é certa. VPA de dez mil reais não
  existe; VPA de centavos existe, e "corrigir" esse lado inventaria um erro
  onde não havia.
- Quando uma trava recusa um número, **imprima o dado cru que a motivou.**
  Recusar protege o ranking mas não explica a fonte, e as hipóteses
  concorrentes ("o filtro descartou a linha certa" × "a linha certa não
  existe assim") pedem correções opostas.

### S6 — Unidade trocada

Razão (`0.185`) tratada como percentagem, ou o contrário. Não quebra nada: só faz o ranking inteiro mentir. Cada fonte tem convenção própria **no mesmo objeto** — no Yahoo, `returnOnEquity` é razão e `debtToEquity` é percentagem. Faixas de sanidade em `FAIXAS` (cvm-parser) e nas séries do SGS existem para apanhar isto.

### S7 — Cliente não pediu o ticker

O universo automático manda ao `op=fundamentals` só a lista curta do ranking. Se o ranking está vazio e o resgate para a carteira modelo não disparou, o ticker nunca é pedido. **Verificação:** aba Rede → ver os `tickers=` do pedido.

### S8 — Cache servindo versão velha

`marketFundamentals` guarda por ramo, com validade própria (`mercadoFetchedAtMs` 24h, `yahooFetchedAtMs` 7 dias, `cvmFetchedAtMs` semanas). Um ramo gravado vazio marca o ticker como "já buscado" e bloqueia nova tentativa. **Regra: nunca gravar ramo com cobertura zero.**

## Etapa 3 — Corrigir, com o teste antes

Só depois de nomear o elo partido. Para cada correção:

1. Escreva o teste que **falha** com o bug presente e descreve o comportamento em linguagem de negócio, não de implementação.
2. Corrija.
3. Rode `npm test` inteiro — a cadeia tem acoplamentos (o topN do cron tem de bater com o do cliente, por exemplo).

**Proibições** — cada uma delas transforma um bug visível num produto que mente:

- Baixar `MOTOR_COBERTURA_MINIMA` para o ativo aparecer.
- Preencher indicador ausente com zero, média do setor ou estimativa.
- Remover o corte de liquidez para o universo parecer maior.
- Atribuir a uma fonte um dado que veio de outra. **Já aconteceu**: a
  degradação de cotação carimbava "Cotação · BRAPI" no que tinha vindo do
  Yahoo, numa instalação sem token de BRAPI. O rótulo sai de QUEM respondeu,
  nunca de quem foi chamado primeiro.
- Silenciar `erros`, `indisponiveis` ou uma degradação de fonte.
- **Dividir o aporte igualmente entre ativos não pontuados.** A recomendação
  sai dos ativos mais bem pontuados — é o produto inteiro. Sem score, a classe
  não recomenda: o valor fica **retido**, com o motivo declarado. Retido é
  diferente de sobra: sobra é troco de lote, retido é decisão adiada. Uma
  divisão igual disfarçada de recomendação é indistinguível, para quem olha a
  tela, de uma recomendação de verdade.

## Etapa 3.5 — O log é o instrumento, não o subproduto

Quatro rodadas contra a CVM real corrigiram quatro classes de defeito, e
**nenhuma delas teria sido encontrada por teste de unidade** — cada peça
estava certa isoladamente. O que as encontrou foi o log, e cada rodada só
foi possível porque a anterior tinha acrescentado o rastro certo.

O ciclo que funcionou:

1. rodar contra dados reais;
2. ler o log procurando número implausível, não só erro;
3. corrigir o que se entendeu **e acrescentar o rastro do que não se
   entendeu**;
4. repetir.

O passo 3 é o que faz a diferença. Exemplos concretos deste projeto:

- imprimir as linhas do `6.03` não reconhecidas revelou, na rodada
  seguinte, que a Eletrobras nomeia a distribuição como
  `pagamento e remuneracao aos acionistas` — sem a palavra "dividendo";
- imprimir o patrimônio absoluto permitiu cruzar o ROE com o valor público
  e descobrir o problema do plano de contas;
- nomear cada URL num bloco que tinha um `catch` só revelou que o 404 vinha
  do cadastro, não do informe.

**Regra:** ao corrigir um sintoma, pergunte o que ainda não sabe explicar
naquele mesmo relatório — e faça o log responder isso na próxima execução.
Um `catch` em volta de três operações produz sempre a mesma mensagem e
esconde qual das três falhou.

## Etapa 4 — Fechar o buraco de observabilidade

Se o diagnóstico exigiu adivinhação, o sistema não estava observável o suficiente. Antes de encerrar, acrescente o que teria respondido à pergunta em um pedido: um campo na resposta, um contador de exclusão, uma linha na tela. **O objetivo é que o mesmo sintoma, da próxima vez, se resolva na Etapa 1.**

---

## Mapa da cadeia

```
mapa-cvm.json / FCA da CVM        → quais tickers existem
        ↓
scripts/ingest-cvm.js (semanal)   → ramo `cvm` de marketFundamentals
        ↓
api/market.js ?op=ranking         → pontua o universo, corta por porte/liquidez
        ↓                            devolve lista curta por classe
web/...aba-carteira-recomendada   → cartUniversoAutomatico() monta o universo
        ↓                            (resgata da carteira modelo se vazio)
api/market.js ?op=fundamentals    → BRAPI (cotação) + Yahoo (fundamentos)
        ↓                            comporFundamentos() empilha cvm > yahoo > mercado
web/appliquei-motor-carteira.js   → scoreAtivo() aplica MOTOR_COBERTURA_MINIMA
        ↓
cartRenderizarMotorRanking()      → desenha score ou "faltam indicadores"
```

Ops de apoio: `?op=rendafixa` (Tesouro), `?op=indicadores` (Selic/CDI/IPCA do BCB),
`?op=quote` (cotação simples — **também exige token desde que a BRAPI apertou**).

## Onde cada fonte funciona

Nem toda fonte funciona de todo lugar, e isso decide **onde** o trabalho mora.

| Fonte                | Precisa de conta? | Da function (Vercel)                        | Do job (GitHub Actions)       |
| -------------------- | ----------------- | ------------------------------------------- | ----------------------------- |
| CVM (dados abertos)  | não               | ✗ ZIPs de dezenas de MB contra 15s e 256 MB | ✓ sem limite                  |
| Yahoo `v8/chart`     | não               | ✓ preço e volume, sem cookie nem crumb      | ✓                             |
| Yahoo `quoteSummary` | cookie + crumb    | ✗ 429                                       | ✗ 429 **também** — ver abaixo |
| BRAPI                | sim (token)       | ✓ **com** `BRAPI_TOKEN`                     | ✓ com token                   |
| CoinGecko            | não               | ✓                                           | ✓                             |
| BCB, Tesouro         | não               | ✓                                           | ✓                             |

**O `quoteSummary` do Yahoo dá 429 do runner do GitHub Actions também.** Isto
foi suposição durante três rodadas ("o IP do runner não é limitado") e o log do
job desmentiu-a: `0 com fundamentos · erros: yahoo_429 · yahoo_429_desistiu`.
Não é uma fonte disponível em lugar nenhum sem cadastro — e por isso o valor de
mercado passou a ser reconstruído do lucro por ação da própria CVM.

**Regra:** quando uma fonte falha por limite de ambiente e não por
configuração, mova o trabalho para o job — **e confirme no log que lá funciona**
antes de construir por cima. Mover não é o mesmo que resolver.

Documentação completa: `docs/MOTOR-CARTEIRA.md`.
