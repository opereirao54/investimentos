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

## Passo 7 — (Recomendado) Limpeza automática no Firestore (3 min)

O bot grava três coleções temporárias. Todas têm o campo `expiraEm`
(Timestamp), e uma política de TTL apaga os documentos vencidos sozinha:

| Coleção             | Para quê                                               | Vence em   |
| ------------------- | ------------------------------------------------------ | ---------- |
| `telegramUpdates`   | evita processar duas vezes a mesma entrega do Telegram | 7 dias     |
| `telegramCodigos`   | códigos de vínculo                                     | 15 minutos |
| `telegramPendentes` | mensagem esperando o usuário escolher o cartão         | 24 horas   |

Firebase Console (<https://console.firebase.google.com/>) → Firestore Database →
aba **TTL** (Time-to-live) → **Create policy**. Para cada coleção acima:
_Collection group_ = nome da coleção, _Timestamp field_ = `expiraEm`.

Sem isso nada quebra: os documentos só ficam acumulando.
Referência: <https://firebase.google.com/docs/firestore/ttl>

## Passo 8 — Política de Privacidade (decisão sua)

A integração adiciona dois tratamentos de dados que a política deve citar:

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

| Caminho                            | Quem escreve                        | Conteúdo                                 |
| ---------------------------------- | ----------------------------------- | ---------------------------------------- |
| `telegramLinks/{chatId}`           | servidor                            | `{uid}`                                  |
| `telegramCodigos/{codigo}`         | servidor                            | vínculo pendente, 15 min                 |
| `telegramPendentes/{id}`           | servidor                            | escolha de cartão pendente, 24 h         |
| `telegramUpdates/{update_id}`      | servidor                            | updates já processados, 7 dias           |
| `users/{uid}/integracoes/telegram` | servidor                            | `chatId`, nome, `ultimoId`, `aprendidas` |
| `users/{uid}/telegramInbox/{id}`   | servidor; o app lê e apaga pela API | itens a aplicar                          |

Nenhuma delas tem regra no `firestore.rules`, de propósito: o cliente nunca
acessa direto, e a negação implícita protege.

### Testes

| Arquivo                                  | Cobre                                                         |
| ---------------------------------------- | ------------------------------------------------------------- |
| `test/lancamento-regra-pura.test.js`     | formulário ≡ `criarLancamentos`                               |
| `test/telegram-parser.test.js`           | interpretação das mensagens                                   |
| `test/telegram-bot.test.js`              | webhook, vínculo, botões, segurança                           |
| `test/telegram-ia.test.js`               | Gemini (rede falsa)                                           |
| `test/telegram-aplicador.test.js`        | aplicação no app                                              |
| `test/telegram-consultas.test.js`        | /saldo, /fatura e /mes iguais ao app (paridade com a sandbox) |
| `test/integracao-inv25-id-unico.test.js` | contrato INV-25                                               |
| `test/simulacao-telegram.test.js`        | entradas inválidas no mundo completo                          |
| `test/_sequencias.js`                    | ações do Telegram nas sequências aleatórias (`npm run cacar`) |

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
