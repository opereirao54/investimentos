# Pendências para o lançamento

Lista viva do que falta para abrir a Appliquei a mais testadores e depois
divulgar. Ao concluir um item, mova-o para "Feito" com a data e o PR.

Última revisão: 11/10/2026.

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

## Código ainda não feito

- [ ] **Botão de reembolso no prazo de arrependimento** (7 dias, CDC art. 49).
      Hoje o reembolso é manual, por pedido; os Termos já preveem.
- [ ] **Limite de requisições em `/api/market`** (opcional, risco baixo:
      exige login e usa cache).

## Feito

- 11/10/2026 · #153 — Termos de Uso + aceite registrado no servidor; Política
  com Telegram/Gemini/GitHub; termo do testador; Sentry sem dados pessoais;
  "sugestão" no lugar de "recomendação"; selo Beta; razão social e CNPJ.
- 11/10/2026 · #154 — Excluir a própria conta (testado em produção); limite de
  tentativas de pagamento (teste de cartão).
- Já existia — antifraude do Applicash (aparelho, CPF, limite de cadastro por IP).
