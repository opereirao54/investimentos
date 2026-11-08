# Pendências para o lançamento

Lista viva do que falta para abrir a Appliquei a mais testadores e depois
divulgar. Ao concluir um item, mova-o para "Feito" com a data e o PR.

Última revisão: 07/11/2026.

## Entrada em produção (cobrança de verdade)

O código está pronto (26/10/2026); o resto é painel. Passo a passo completo em
`BILLING.md` → "Virada do sandbox para a produção".

- [ ] **Conta Asaas de produção aprovada** (documentos da empresa + conta
      bancária para saque).
- [ ] **Chave de produção** (`$aact_prod_...`) em `ASAAS_API_KEY` no lugar
      da do sandbox, na mesma Vercel de hoje (um ambiente só, sem
      homologação). `ASAAS_API_URL=https://api.asaas.com/v3` (ou vazia).
      A partir daí todo teste de pagamento cobra de verdade.
- [ ] **`ASAAS_WEBHOOK_TOKEN` novo** + **webhook criado na conta de produção**
      com todos os eventos de Cobrança e Assinatura (inclui os quatro do item
      "Webhook da Asaas" abaixo).
- [ ] **Redeploy** e **teste com cartão real**: assinar → acesso liberado →
      webhook `200` no painel → estornar → acesso cai.
- [ ] **Domínio próprio** (ex.: appliquei.com.br). Hoje o canônico é
      `investimentos-ebon.vercel.app` (script no `<head>` do app). Ao trocar:
      canônico no app, URL do webhook no Asaas, domínios autorizados no
      Firebase Auth e webhook do Telegram (`npm run telegram:webhook`).
- [ ] **Cadastro aberto**: desligar "cadastro só com convite" no admin no dia
      de abrir para o público.
- [ ] **Sentry do navegador**: `window.__APPLIQUEI_SENTRY_DSN__` está vazio no
      HTML (só o servidor reporta erro hoje).
- [ ] **Termos v2026-10-26**: saiu a seção do Applicash; todos aceitam de
      novo no próximo acesso. Entra na revisão jurídica abaixo.

## Jurídico (antes de divulgar)

- [ ] **Carteira sugerida × CVM.** Consultar advogado de mercado de capitais:
      sugerir ativos e valores por ativo exige credenciamento (Res. CVM 19/20)?
      Pode exigir ajuste no produto ou parceria com analista CNPI.
- [ ] **Revisão jurídica** dos Termos de Uso (`web/appliquei-termos.js`) e da
      Política de Privacidade (`web/appliquei-privacidade.js`).

## Dependem dos sócios (painéis, cadastros, decisões)

- [ ] **E-mail de contato** → preencher `PRIVACIDADE_CONTROLADOR.email` em
      `web/appliquei-privacidade.js` (os Termos leem dali). Hoje o único canal
      citado é a aba "Enviar sugestão".
- [ ] **Webhook da Asaas**: conferir que `PAYMENT_REFUNDED`,
      `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_DELETED` e `SUBSCRIPTION_DELETED`
      estão marcados (Asaas → Integrações → Webhooks).
- [ ] **Backup do Firestore**: ativar backup diário e PITR no Google Cloud.
- [ ] **Teto de gastos**: orçamento com alertas no Google Cloud (Firebase +
      Gemini) e, se Vercel Pro, Spend Management.
- [ ] **E-mail verificado obrigatório**: rodar
      `scripts/backfill-email-verification.js --dry-run` com a credencial de
      produção; se poucos pendentes, `EMAIL_VERIFY_ENFORCE=true` na Vercel e
      promover `firestore.rules.enforced` (AUDITORIA.md, A2).
- [ ] **Nota fiscal** das assinaturas (Asaas + Contabilizei).
- [ ] **Data oficial de lançamento** no admin (Convites → Data de lançamento):
      conta o ano grátis dos testadores.
- [ ] **Marca** "Appliquei" no INPI.
- [ ] **Canal de suporte** e prazo de resposta.

## Decisões em aberto

- Benefício do testador nos Termos: "50% de desconto, sem prazo final,
  enquanto a conta existir" — confirmar.
- Aviso de 30 dias antes de mudar o preço (nos Termos) — manter ou tirar.
- Plano B se o advogado exigir credenciamento para a carteira sugerida.
- Patrimônio e Controle (07/11/2026), escolhas feitas na implementação que
  valem confirmar: o Patrimônio abre em **Líquido** quando há dívida; dívida =
  financiamentos ativos + faturas aberta/fechada não pagas (parcelas futuras
  ficam de fora); o número grande do Controle é a **sobra do mês** (a
  acumulada virou selo/linha). Proposta completa no canvas "Appliquei —
  Patrimônio e Controle".
- Vercel: fica no Hobby, um ambiente só, por enquanto (26/10/2026). Revisitar
  quando a receita justificar: os termos do Hobby são para uso não comercial,
  e o Pro tira o teto de 12 funções e dá o Spend Management.

## Código ainda não feito

- [ ] **Botão de reembolso no prazo de arrependimento** (7 dias, CDC art. 49).
      Hoje o reembolso é manual, por pedido; os Termos já preveem.
- [ ] **Limite de requisições em `/api/market`** (opcional, risco baixo:
      exige login e usa cache).
- [ ] **Patrimônio e Controle — o que o canvas propõe e ainda não entrou**
      (07/11/2026): liquidez da renda fixa (falta o campo de prazo de
      resgate); "por que mudou" separando proventos e amortização; gráfico do
      líquido no passado (reconstruir o saldo devedor pelo contrato).

## Feito

- 07/11/2026 · branch `claude/intelligent-ritchie-6o5r6m` (2ª leva) — Faturas
  do cartão no layout novo (limite, parcela, comprometido); folha do
  lançamento no celular (pagar, outro valor, adiar, só este mês); limite por
  categoria e Metas do mês em % (réguas da Saúde do mês); nova conta em grade
  de instituições, editar conta com arquivar; conferir saldo com "lançar a
  diferença"; novo bem em passos com busca FIPE única; painel do bem com
  "quanto já é seu", financiamento e registro de antecipação — que também
  corrige as parcelas do Controle (prazo menor tira as do fim, parcela menor
  muda o valor), com Desfazer.
- 08/11/2026 · mesma branch — Projeção nova: resumo (quanto terá, menor
  ponto, sobra média), linha da sobra acumulada, alerta do mês negativo com
  o motivo, aviso de receita não lançada, entra × sai, "o que muda", mês a
  mês com o comprometido e o "E se…?" para testar uma compra ou entrada.
- 07/11/2026 · branch `claude/intelligent-ritchie-6o5r6m` — Patrimônio: web com
  líquido/bruto, linha do tempo, balanço tem/deve, "por que mudou", fôlego,
  classes em lista, contas sem lista duplicada; celular com lista de
  instituições, 1M, dívidas e "gerenciar contas". Controle: sobra do mês em
  destaque nos dois, "Saúde do mês" com os critérios do termômetro, gastos por
  categoria × média, projeção em barras no web, sem os valores repetidos.

- 26/10/2026 · produção — Applicash desligado (tela: `APPLICASH_ATIVO` no
  `<head>` do app; servidor: `APPLICASH_ENABLED`); "Pro + IA" fora da landing e
  do app (um plano só); Asaas: ambiente pela chave, erro claro com chave e URL
  trocadas, troca automática do cliente do sandbox no `/subscribe`.
- 11/10/2026 · #153 — Termos de Uso + aceite registrado no servidor; Política
  com Telegram/Gemini/GitHub; termo do testador; Sentry sem dados pessoais;
  "sugestão" no lugar de "recomendação"; selo Beta; razão social e CNPJ.
- 11/10/2026 · #154 — Excluir a própria conta (testado em produção); limite de
  tentativas de pagamento (teste de cartão).
- 12/10/2026 · caça de furos em pagamentos e cupons (`npm run cacar:pagamentos`,
  semanal no GitHub) — 8 defeitos de dinheiro/fraude corrigidos.
- 13/10/2026 · tela de Faturas do cartão (fatura paga não some mais) e
  extrato por data, agrupado por dia, com o cartão numa linha por fatura.
- Já existia — antifraude do Applicash (aparelho, CPF, limite de cadastro por IP).
