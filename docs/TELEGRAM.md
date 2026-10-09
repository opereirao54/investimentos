# Lançar pelo Telegram — guia de implantação

O usuário manda `mercado 52,90` para o bot do Telegram e a despesa entra no
Appliquei. Também funciona para receitas, despesas fixas e compras no cartão
(`nubank 300 tênis 3x`).

**Custo: zero.** Nenhum serviço novo é pago:

| Peça                     | Serviço                                    | Custo                                                           |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| Bot                      | Telegram Bot API                           | grátis, sem limite relevante                                    |
| Webhook                  | Vercel, rota que já existe (`api/user.js`) | não cria função nova (o limite de 12 do Hobby continua igual)   |
| Dados                    | Firestore que já existe                    | poucas leituras e gravações por mensagem, dentro da cota grátis |
| IA de reserva (opcional) | Gemini, plano gratuito                     | grátis; se a cota diária acabar, o bot pede o formato padrão    |

> Os links abaixo são as páginas oficiais. Não consegui abri-los do ambiente
> onde este guia foi escrito, então, se algum tiver mudado de endereço,
> procure pelo título da página no site do serviço.

---

## Passo 1 — Criar o bot no Telegram (5 min)

1. No Telegram, abra o **@BotFather**: <https://t.me/BotFather>
2. Mande `/newbot`.
3. **Nome** (o que aparece na conversa): por exemplo `Appliquei`.
4. **Username** (tem de terminar em `bot`): por exemplo `AppliqueiBot`.
   Anote esse nome **sem o @**. Ele vira a variável `TELEGRAM_BOT_USERNAME`.
5. O BotFather responde com o **token**, algo como
   `7123456789:AAH...`. Ele vira a variável `TELEGRAM_BOT_TOKEN`.
   **Trate como senha**: quem tem o token controla o bot. Se vazar, mande
   `/revoke` ao BotFather para gerar outro.
6. (Opcional, cosmético) No BotFather:
   - `/setdescription`: "Lance despesas e receitas no Appliquei mandando uma mensagem."
   - `/setabouttext`: "Bot oficial de lançamentos do Appliquei."
   - `/setuserpic`: envie o ícone do app (`icons/`).

Referência: <https://core.telegram.org/bots/tutorial>

## Passo 2 — Gerar o segredo do webhook (1 min)

O segredo garante que só o Telegram consegue chamar o webhook. Sem ele,
qualquer pessoa poderia forjar mensagens e lançar despesas na conta de alguém.

No terminal, na pasta do projeto:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guarde o resultado (64 caracteres). Ele vira a variável `TELEGRAM_WEBHOOK_SECRET`.

## Passo 3 — (Opcional) Chave do Gemini gratuito (3 min)

Sem a chave, o bot funciona só com as regras, que cobrem os formatos da
tabela do fim deste guia. Com a chave, ele também entende frases soltas como
"gastei uns cinquenta conto no mercado" e escolhe a categoria quando nenhuma
palavra-chave bate.

1. Entre em <https://aistudio.google.com/apikey> com uma conta Google.
2. **Create API key**: crie a chave num projeto novo e **não ative
   faturamento** nesse projeto. Projeto sem faturamento fica no plano grátis.
3. A chave vira a variável `GEMINI_API_KEY`.
4. Limites do plano grátis: <https://ai.google.dev/gemini-api/docs/rate-limits>.
   O Flash-Lite tinha na casa de 1.000 pedidos por dia em 2026. O bot só chama
   a IA quando as regras não entendem, e no máximo uma vez por mensagem.
5. **Privacidade:** no plano grátis o Google pode usar o conteúdo enviado
   para melhorar os produtos dele. Ver <https://ai.google.dev/gemini-api/terms>.
   Por isso o bot manda **só o texto da mensagem** (ou só a descrição e os
   nomes das categorias). Nunca vão nome, e-mail, id, contas ou saldos. Mesmo
   assim, isso precisa entrar na Política de Privacidade (Passo 8).

Variável opcional: `GEMINI_MODEL` (padrão `gemini-flash-lite-latest`, um alias
que acompanha a versão vigente do Flash-Lite). Só mude se o Google aposentar
o alias.

## Passo 4 — Variáveis de ambiente na Vercel (3 min)

Vercel → seu projeto → **Settings → Environment Variables**
(<https://vercel.com/docs/environment-variables>). Adicione em **Production**,
e em **Preview** se quiser testar num deploy de preview:

| Nome                      | Valor                                        | Obrigatória |
| ------------------------- | -------------------------------------------- | ----------- |
| `TELEGRAM_BOT_TOKEN`      | token do Passo 1                             | sim         |
| `TELEGRAM_BOT_USERNAME`   | username do bot, sem @ (ex.: `AppliqueiBot`) | sim         |
| `TELEGRAM_WEBHOOK_SECRET` | segredo do Passo 2                           | sim         |
| `GEMINI_API_KEY`          | chave do Passo 3                             | não         |
| `GEMINI_MODEL`            | deixe vazio                                  | não         |

Variável nova só vale depois de um deploy novo. Faça o Passo 5 depois desta.

## Passo 5 — Publicar o código

O código está no branch `claude/telegram-lancamentos`. Abra o PR, deixe o CI
passar e faça o merge para o deploy de produção.

Não há Security Rules novas para publicar. O app lê a caixa de entrada pela
API (Admin SDK), justamente para não depender de `npm run regras:publicar`.

## Passo 6 — Ligar o webhook (2 min, uma vez só)

Com o deploy no ar, rode no terminal, na pasta do projeto (troque o domínio
pelo de produção):

```bash
TELEGRAM_BOT_TOKEN='7123456789:AAH...' \
TELEGRAM_WEBHOOK_SECRET='o-segredo-do-passo-2' \
npm run telegram:webhook -- https://SEU-DOMINIO
```

A saída esperada é:

```
Webhook ligado em https://SEU-DOMINIO/api/telegram
Menu de comandos configurado.
Bot: @AppliqueiBot  (use este nome em TELEGRAM_BOT_USERNAME)
URL:               https://SEU-DOMINIO/api/telegram
Pendentes:         0
Tipos de update:   message, callback_query
Último erro:       nenhum
```

Para conferir depois: `npm run telegram:webhook -- --info` (com o
`TELEGRAM_BOT_TOKEN` no ambiente). Para desligar: `-- --remover`.

**O segredo usado aqui tem de ser exatamente o mesmo da Vercel.** Se forem
diferentes, todo update volta 401 e aparece em "Último erro" no `--info`.

Referência: <https://core.telegram.org/bots/api#setwebhook>

**Menu "☰" (lista de comandos): automático.** O bot aplica a lista sozinho
(`MENU_COMANDOS` em `api/_lib/telegram-api.js`) no primeiro uso depois de um
deploy que a tenha mudado. Não precisa do @BotFather nem deste script para
isso.

## Passo 7 — (Recomendado) Limpeza automática no Firestore (3 min)

O bot grava três coleções temporárias. Todas têm o campo `expiraEm`
(Timestamp), e uma política de TTL apaga os documentos vencidos sozinha:

| Coleção              | Para quê                                               | Vence em   |
| -------------------- | ------------------------------------------------------ | ---------- |
| `telegramUpdates`    | evita processar duas vezes a mesma entrega do Telegram | 7 dias     |
| `telegramCodigos`    | códigos de vínculo                                     | 15 minutos |
| `telegramPendentes`  | mensagem esperando o usuário escolher o cartão         | 24 horas   |
| `telegramRelatorios` | pedidos de Relatório Mensal em PDF                     | 24 horas   |

Firebase Console (<https://console.firebase.google.com/>) → Firestore Database →
aba **TTL** (Time-to-live) → **Create policy**. Para cada coleção acima:
_Collection group_ = nome da coleção, _Timestamp field_ = `expiraEm`.

Sem isso nada quebra: os documentos só ficam acumulando.
Referência: <https://firebase.google.com/docs/firestore/ttl>

## Passo 8 — Política de Privacidade (decisão sua)

A integração adiciona três tratamentos de dados que a política deve citar:

> **Telegram (opcional).** Se você conectar sua conta ao bot do Appliquei no
> Telegram, guardamos o identificador da conversa, seu nome e @usuário no
> Telegram, e o texto das mensagens que você envia ao bot, para registrar
> seus lançamentos. Você pode desconectar a qualquer momento em Configurações
> ou mandando /desconectar ao bot.
>
> **Interpretação de mensagens.** Quando o bot não entende uma mensagem pelas
> regras, o texto dela (sem nenhum dado que identifique você) pode ser enviado
> ao Google Gemini para interpretação. O Google pode usar esse texto para
> melhorar os próprios serviços.
>
> **Relatório em PDF pelo Telegram.** Quando você pede o Relatório Mensal pelo
> bot, seus dados financeiros são processados por alguns segundos num servidor
> do GitHub (Microsoft), que gera o PDF e o envia para a sua conversa. Nada é
> guardado lá depois do envio.

Trocar o texto da política e subir `PRIVACIDADE_VERSAO` em `api/user.js` faz
todos os usuários aceitarem de novo. Não mexi nisso: é decisão jurídica e de
produto. Se não for usar o Gemini, basta o primeiro parágrafo.

## Passo 9 — Testar de ponta a ponta (10 min)

1. Abra o app → **⚙ Configurações → Lançar pelo Telegram**.
2. Escolha a **Conta principal**.
3. **Conectar Telegram** → **Abrir o Telegram e tocar em Iniciar** → no
   Telegram, toque em **Iniciar**. O bot responde "🎉 Conectado!".
4. Mande e confira:

| Mensagem                                  | O bot deve responder                            | No app                                                             |
| ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `mercado 52,90`                           | Despesa lançada · Alimentação · conta principal | despesa variável paga, saldo da conta cai R$ 52,90                 |
| `ontem uber 18`                           | data de ontem · Transporte                      | no mês de ontem                                                    |
| `+3500 salário`                           | Receita lançada                                 | receita na conta principal                                         |
| `nubank 300 tênis 3x`                     | 💳 Nubank · 3x de R$ 100,00                     | 3 parcelas na fatura aberta                                        |
| `cartão 89 farmácia` (com 2+ cartões)     | pergunta qual cartão, com botões                | entra no cartão escolhido                                          |
| `aluguel 1800 fixa dia 10`                | 🔁 Fixa mensal · vence dia 10                   | despesa fixa recorrente                                            |
| `presente 150` → **🏷️ Categoria** → Lazer | categoria trocada                               | categoria Lazer; a próxima mensagem com "presente" já vem em Lazer |
| qualquer uma → **↩️ Desfazer**            | Desfeito                                        | lançamento some                                                    |
| `mercado` (sem valor)                     | dica de formato                                 | nada                                                               |

5. Consultas (o teclado fixo embaixo da conversa tem os três atalhos):

| Mensagem                         | O bot deve responder                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `/saldo` ou **💰 Saldo**         | saldo de cada conta e o total, igual ao "Saldo em conta" do Meu Patrimônio     |
| `/fatura` ou **💳 Fatura**       | fatura aberta de cada cartão (fechamento e vencimento) e a fechada, se a pagar |
| `/mes` ou **📊 Mês**             | receitas, despesas, cartão, resultado e gastos por categoria; ◀ ▶ trocam o mês |
| qualquer consulta com lançamento | "⏳ N lançamentos feitos aqui ainda não entraram no app"                       |

Quem já tinha ligado o webhook antes das consultas precisa rodar o Passo 6
de novo, só para o menu "/" do Telegram ganhar os comandos novos. Os
comandos funcionam mesmo sem isso.

6. Volte ao app (ou atualize a página): aparece "📲 N lançamentos do Telegram
   entraram". Com o app aberto, entra em até 2 minutos ou ao voltar para a aba.

## Alertas automáticos (sem terminal)

O bot avisa sozinho, duas vezes por dia no máximo (uma mensagem por horário,
juntando tudo). Tudo vem ligado; o usuário desliga pelo 🔕 de cada aviso, pelo
botão **🔔 Alertas** ou mandando "parar alertas".

| Horário (Brasília) | Alerta                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| ☀️ ~7h             | conta vencendo hoje/amanhã · conta vencida (até 3 dias) · com **✅ Já paguei**    |
| ☀️ ~7h             | fatura fechando em 1–2 dias · fatura vencendo hoje/amanhã (com ✅ Já paguei)      |
| ☀️ ~7h             | **sai antes de entrar**: o caixa projetado fica negativo nos próximos 10 dias     |
| 🌙 ~18h            | **limite de 60% da receita** (régua do termômetro do Controle), uma vez por faixa |
| 🌙 ~18h            | ritmo: variáveis + cartão já passaram o mês anterior inteiro                      |
| 🌙 ~18h            | lembrete: 3 dias sem lançar nada                                                  |
| 🌙 ~18h            | sonho conquistado                                                                 |

Quem dispara é o **GitHub Actions** (`.github/workflows/telegram-alertas.yml`),
porque o cron da Vercel Hobby só roda uma vez por dia e as duas vagas estão
ocupadas. Ele chama `POST /api/user?op=telegram-alertas` com o `CRON_SECRET`.

O GitHub atrasa o agendamento em horas e às vezes pula rodadas. Por isso a
rodada sai de hora em hora desde cedo (manhã 07:07–11:07, noite 18:07–22:07)
e cada janela aceita até o fim do período (manhã 7h–12h59, noite 18h–23h59):
a primeira rodada que chegar manda, as outras não repetem.

### Ligar (uma vez, 5 min, só no navegador)

1. **Confira o `CRON_SECRET` na Vercel.** Projeto → **Settings → Environment
   Variables**. Os crons que já existem usam essa variável, então ela
   provavelmente já está lá. Se não estiver, crie com um valor longo e
   aleatório (um gerador de senha de 40+ caracteres serve) e faça um
   **Redeploy** (Deployments → ⋯ no último → Redeploy).
2. **Crie os dois secrets no GitHub.** Repositório → **Settings → Secrets and
   variables → Actions → New repository secret**:
   - `APP_URL` = o endereço de produção, sem barra no fim (`https://seu-dominio`)
   - `CRON_SECRET` = **exatamente** o mesmo valor da Vercel
3. **Teste.** Aba **Actions** → **Alertas do Telegram** → **Run workflow** →
   escolha a janela (`manha` ou `noite`) → **Run workflow**. Em ~1 minuto o
   job fica verde e o log mostra, por exemplo,
   `{"ok":true,"janela":"manha","processados":3,"motivos":{"enviado":1,"nada":2}}`.
   Quem tinha algo a receber recebe no Telegram.

Depois disso roda sozinho. Cada janela sai uma vez por dia por usuário: rodar
de novo no mesmo dia não repete nada.

### O que o log da rodada quer dizer

| motivo          | significado                                                        |
| --------------- | ------------------------------------------------------------------ |
| `enviado`       | mandou a mensagem                                                  |
| `nada`          | não havia aviso novo (ou todos desligados)                         |
| `ja_tratado`    | essa janela já saiu hoje para o usuário                            |
| `pausado`       | o usuário pausou todos                                             |
| `assinatura`    | assinatura inativa                                                 |
| `bot_bloqueado` | o usuário bloqueou o bot; volta a tentar em 7 dias                 |
| `falha_envio`   | o Telegram recusou agora; a próxima rodada da janela tenta de novo |
| `erro`          | dado inesperado desse usuário (detalhe nos logs da Vercel)         |

Job vermelho: abra o job **rodada**. A última linha em vermelho diz a causa e o
que fazer. O workflow mostra a resposta do servidor e a interpreta:

| A resposta                     | Causa                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| "Faltam os secrets"            | falta `APP_URL` ou `CRON_SECRET` no GitHub                    |
| `{"error":"unauthorized"}`     | `CRON_SECRET` do GitHub diferente do da Vercel                |
| `{"error":"invalid_token"}`    | respondeu uma versão antiga do app (deploy não terminou)      |
| `{"error":"cron_disabled"}`    | falta `CRON_SECRET` na Vercel, ou faltou o Redeploy           |
| página HTML de login da Vercel | `APP_URL` é um endereço de preview; use o domínio de produção |
| HTTP 404 ou 000                | `APP_URL` errado                                              |

### Para desligar tudo

Aba **Actions** → **Alertas do Telegram** → **⋯** → **Disable workflow**.

### "✅ Já paguei"

Funciona como o lançamento: o bot deixa a ordem na caixa de entrada e o app dá
a baixa ao abrir, pelas mesmas funções do botão **Baixar** do Controle (conta
pagadora do cartão, aporte do sonho, posição do compromisso). Contrato
**INV-26** no mapa de integrações. Uma aba do app aberta desde antes desta
versão não conhece a ordem e a descarta: recarregar o app resolve, e o
pagamento é refeito pelo app.

## Relatório Mensal em PDF (sem terminal)

O botão **📄 Relatório** (ou `/relatorio`) pergunta o mês e, em 1 a 2 minutos,
manda o PDF na conversa. É **o mesmo relatório do app** (Relatório mensal →
Exportar PDF): o próprio código do app monta o documento e um Chromium o
imprime. Não há cópia da regra.

```
Bot ── grava telegramRelatorios/{id} ──▶ API do GitHub: workflow_dispatch(pedido=id)
                                               │
GitHub Actions (relatorio-telegram.yml) ◀──────┘
  └─ scripts/relatorio-telegram.js
       ├─ lê o pedido, users/{uid}/data/main e a caixa de entrada (Firestore)
       ├─ abre o app numa sandbox com esses dados (scripts/lib/app-sandbox.js),
       │  aplica a caixa de entrada e busca os dividendos — como o app ao abrir
       ├─ rmDocumentoImprimivel(mês) → Chromium → PDF
       └─ sendDocument para o chat do pedido
```

Roda no GitHub porque a Vercel Hobby não roda navegador. O repositório é
público, então **o log também é**: a única entrada do workflow é o id
(aleatório) do pedido, e o script só registra "pedido X: enviado/erro".
Nenhum dado do usuário vai para o log nem fica guardado como arquivo.

### Ligar (uma vez, ~5 min, só no navegador)

1. **Token do GitHub para o bot acionar o workflow.**
   <https://github.com/settings/personal-access-tokens/new> →
   _Token name_: `appliquei-relatorio` · _Expiration_: a mais longa que quiser
   (anote para renovar) · _Repository access_: **Only select repositories** →
   `investimentos` · _Permissions → Repository permissions → **Actions**_:
   **Read and write** → **Generate token** → copie (começa com `github_pat_`).
2. **Na Vercel:** Settings → Environment Variables → `GITHUB_DISPATCH_TOKEN` =
   o token do passo 1 → salvar → **Redeploy**.
3. **No GitHub:** Settings → Secrets and variables → Actions → New repository
   secret → `TELEGRAM_BOT_TOKEN` = o mesmo token do bot que está na Vercel.
   (`FIREBASE_SERVICE_ACCOUNT_BASE64` e `FIREBASE_PROJECT_ID` já existem.)
4. **Teste:** no Telegram, **📄 Relatório** → um mês. Em 1–2 min o PDF chega.
   Acompanhe em Actions → **Relatório pelo Telegram**.
5. (Recomendado) **TTL** da coleção `telegramRelatorios`, campo `expiraEm`
   (mesmo procedimento do Passo 7).

### Se não chegar

| O que aparece                                    | Causa                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| "ainda não foi ativado"                          | falta `GITHUB_DISPATCH_TOKEN` na Vercel (ou faltou o Redeploy)         |
| "Não consegui pedir o relatório"                 | token vencido, sem permissão de Actions, ou de outro repositório       |
| "Não consegui gerar o relatório agora"           | o workflow rodou e falhou: veja o log em Actions (só o código do erro) |
| nada chega e não há execução em Actions          | o pedido não saiu do bot: logs da Vercel com `[telegram-relatorio]`    |
| execução em Actions vermelha em "Gerar e enviar" | falta `TELEGRAM_BOT_TOKEN` ou os secrets do Firebase no GitHub         |

Limite: 6 relatórios por hora por usuário. Um pedido com mais de 30 minutos
(fila do GitHub travada) é descartado em vez de chegar atrasado.

## Solução de problemas

| Sintoma                                                        | Causa provável                                | O que fazer                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Bot não responde nada                                          | webhook desligado, ou segredo diferente       | `npm run telegram:webhook -- --info` e veja "Último erro"; 401 = segredo da Vercel diferente do usado no Passo 6 |
| "O Telegram ainda não foi configurado no servidor" ao conectar | falta `TELEGRAM_BOT_USERNAME`                 | Passo 4 + redeploy                                                                                               |
| "Esse link de conexão expirou"                                 | passou de 15 min ou o link já foi usado       | gerar outro no app                                                                                               |
| "Não sei de qual conta sai esse dinheiro"                      | sem conta principal e mais de uma conta       | escolher a conta principal em Configurações                                                                      |
| Lançou no bot mas não aparece no app                           | o app ainda não buscou a caixa                | abrir ou atualizar o app; com o app aberto, esperar até 2 min                                                    |
| "Sua assinatura está inativa"                                  | trial ou assinatura vencida                   | regularizar a assinatura                                                                                         |
| IA nunca entra                                                 | sem `GEMINI_API_KEY`, ou cota do dia esgotada | conferir a variável; a cota reinicia todo dia                                                                    |

Erros do servidor aparecem nos logs da Vercel (Project → Logs) com o prefixo
`[telegram]` ou `[telegram-ia]`.

## Atenção: plano Hobby da Vercel

O Hobby é para uso **não comercial**
(<https://vercel.com/docs/limits/fair-use-guidelines>). Isso não muda nada
neste código, mas um produto pago rodando no Hobby é um risco de conta. O
plano Pro resolve.

---

## Como funciona (para quem for mexer no código)

```
Telegram ──POST /api/telegram──▶ api/user.js?op=telegram
                                   │  confere header secreto
                                   ▼
                          api/_lib/telegram-bot.js
                          ├─ telegram-parser.js  (regras, puro)
                          ├─ telegram-ia.js      (Gemini, só se as regras falharem)
                          └─ grava users/{uid}/telegramInbox/tg<chat>_<msg>
                                   │
App (web/appliquei-telegram.js) ◀─GET /api/user?op=telegram-inbox
  └─ criarLancamentos()  ← o MESMO do formulário
  └─ salvarTransacoes()  → sync normal
  └─ POST telegram-inbox {ids} → servidor apaga da caixa
```

**Por que caixa de entrada e não gravar direto nas transações:** todas as
transações vivem num único JSON (`futurorico_transacoes`) sincronizado por
"última versão vence" (`api/sync/push.js`). Se o servidor gravasse nele, o
próximo salvamento de um aparelho com a cópia antiga apagaria o lançamento
sem ninguém ver.

**Idempotência:** o id é fixo (`tg<chat>_<msg>`, e as transações
`tg<chat>_<msg>_<n>`). O Telegram reentregando, a confirmação do app se
perdendo ou dois aparelhos abertos não duplicam nada. Isso é o contrato
**INV-25** em `.claude/integracoes/mapa.json`.

**Desfazer e Categoria** sempre deixam um item na caixa
(`desfazer_<id>` / `cat_<id>`), além de mexer no lançamento se ele ainda
estiver lá. Saber se o app já aplicou exigiria ler o JSON das transações, e um
app lendo a caixa naquele instante tornaria a resposta errada de qualquer
jeito.

**Consultas (/saldo, /fatura, /mes):** só leem `users/{uid}/data/main`, nada é
gravado. As regras ficam em `api/_lib/telegram-consultas.js`, uma cópia das
funções do app (`mpCalcularSaldoPorInstituicao`, `cartaoFaturasCandidatas`,
`calcularResumoMes`…), porque o servidor não carrega os scripts do navegador.
`test/telegram-consultas.test.js` roda o app e o servidor sobre o mesmo estado e
exige o mesmo número. **Mudou uma dessas regras no app, mude a cópia.** O teste
avisa se esquecer. A data de referência é a de Brasília (`agoraBrasilia`), não o
UTC da Vercel.

**Conta principal:** a flag `principal: true` em `appliquei_contas`. Se só
houver uma conta de caixa (não corretora, não arquivada), ela é a principal.

### Coleções

| Caminho                                   | Quem escreve                        | Conteúdo                                 |
| ----------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `telegramLinks/{chatId}`                  | servidor                            | `{uid}`                                  |
| `telegramCodigos/{codigo}`                | servidor                            | vínculo pendente, 15 min                 |
| `telegramPendentes/{id}`                  | servidor                            | escolha de cartão pendente, 24 h         |
| `telegramUpdates/{update_id}`             | servidor                            | updates já processados, 7 dias           |
| `users/{uid}/integracoes/telegram`        | servidor                            | `chatId`, nome, `ultimoId`, `aprendidas` |
| `users/{uid}/telegramInbox/{id}`          | servidor; o app lê e apaga pela API | itens a aplicar                          |
| `users/{uid}/integracoes/telegramAlertas` | servidor                            | preferências e registro dos alertas      |

Nenhuma delas tem regra no `firestore.rules`, de propósito: o cliente nunca
acessa direto, e a negação implícita protege.

### Testes

| Arquivo                                        | Cobre                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `test/lancamento-regra-pura.test.js`           | formulário ≡ `criarLancamentos`                                              |
| `test/telegram-parser.test.js`                 | interpretação das mensagens                                                  |
| `test/telegram-bot.test.js`                    | webhook, vínculo, botões, segurança                                          |
| `test/telegram-ia.test.js`                     | Gemini (rede falsa)                                                          |
| `test/telegram-aplicador.test.js`              | aplicação no app                                                             |
| `test/telegram-consultas.test.js`              | /saldo, /fatura e /mes iguais ao app (paridade com a sandbox)                |
| `test/telegram-alertas.test.js`                | regras, rodada, painel 🔔, 🔕, Já paguei, endpoint, paridade da projeção     |
| `test/integracao-inv26-baixa-telegram.test.js` | Já paguei ≡ Baixar do Controle (INV-26)                                      |
| `test/relatorio-pdf.test.js`                   | relatório gerado na sandbox = documento do app; caixa de entrada; dividendos |
| `test/telegram-relatorio.test.js`              | botão 📄, pedido, acionamento do GitHub, script do workflow                  |
| `e2e/relatorio-pdf.spec.js`                    | impressão real em Chromium: PDF A4 de uma página                             |
| `test/integracao-inv25-id-unico.test.js`       | contrato INV-25                                                              |
| `test/simulacao-telegram.test.js`              | entradas inválidas no mundo completo                                         |
| `test/_sequencias.js`                          | ações do Telegram nas sequências aleatórias (`npm run cacar`)                |

### Formatos que as regras entendem

| Pista na mensagem                                             | Efeito                                              |
| ------------------------------------------------------------- | --------------------------------------------------- |
| número (`52,90`, `1.800`, `R$ 18`)                            | valor; dois números sem destaque viram pergunta     |
| `+` antes do valor, ou recebi / salário / freela / reembolso… | receita                                             |
| `-` antes do valor                                            | força despesa                                       |
| nome de cartão, `cartão`, `crédito`, `3x`, `em 3 vezes`       | compra no cartão (fatura aberta)                    |
| nome de conta, `pix`, `débito`                                | sai da conta                                        |
| nada disso                                                    | conta principal                                     |
| `fixa`, `todo mês`, `mensal`                                  | recorrente (no cartão: assinatura mensal na fatura) |
| `dia 10`                                                      | vencimento no próximo dia 10                        |
| `ontem`, `anteontem`, `05/10`                                 | data da compra (define o mês)                       |
| palavra conhecida (mercado, uber, farmácia, netflix…)         | categoria                                           |
