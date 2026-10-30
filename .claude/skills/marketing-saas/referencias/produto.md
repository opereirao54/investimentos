# O produto, para quem vende

Ficha de fatos para o marketing. **Tudo aqui tem de bater com o app e com a
landing.** Quando o produto mudar, atualize esta ficha no mesmo PR.

Última revisão: 26/10/2026.

## Em uma frase

A Appliquei junta o seu patrimônio, o seu mês e os seus investimentos numa tela
só, e ajuda você a dar o próximo passo com a conta aberta em vez de um palpite.

Frase de bolso (peças curtas): **"Seu dinheiro inteiro, numa tela só."**

## Oferta vigente

| Item                  | Hoje                                                          | Onde conferir                                                                   |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Plano                 | **Pro, R$ 15/mês**                                            | `landing.html` (seção Planos), `BILLING.md`, `api/_lib/asaas.js` (`PLAN_VALUE`) |
| Teste grátis          | **7 dias, sem cartão, sem cobrança automática no fim**        | `landing.html` (hero e Planos)                                                  |
| Pagamento             | PIX, boleto ou cartão recorrente (Asaas)                      | `landing.html`                                                                  |
| Cancelamento          | Quando quiser, sem multa                                      | `landing.html`                                                                  |
| Pro + IA              | **Fora da grade** — não existe; não citar nem como "em breve" | decisão do fundador, 26/10/2026 (saiu da landing e do app)                      |
| Applicash (indicação) | **Desligado no app** — não usar em peças até nova versão      | decisão do fundador, 16 e 26/10/2026 (`APPLICASH_ENABLED`, `APPLICASH_ATIVO`)   |
| Testadores (beta)     | Grupo de teste; benefício ainda em definição                  | `docs/PENDENCIAS-LANCAMENTO.md`                                                 |

Para o grupo de teste, **não** use "7 dias grátis": o convite é "use no dia a
dia e me conte o que achou".

## O que o app faz (pode divulgar)

| Funcionalidade          | Como vender                                                                                                | Onde conferir                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Controle do mês         | Receitas, despesas e cartões, e quanto sobrou de verdade                                                   | aba Controle (`web/appliquei-aba-controle-financeiro.js`)  |
| Patrimônio somado       | Contas, investimentos e bens num lugar só                                                                  | `web/appliquei-patrimonio.js`                              |
| Aviso de caixa apertado | Avisa o dia em que o saldo fura, dias antes, com o valor                                                   | `web/appliquei-insights.js` (`insightsAperto`)             |
| Sistema inteligente     | Gasto fora da curva, cobrança repetida, reajuste, despesa fixa não marcada. **É estatística, não IA**      | `web/appliquei-insights.js`                                |
| Lançar pelo Telegram    | "mercado 52,90" vira despesa lançada; parcelado no cartão; receitas e fixas (inclusive salário recorrente) | `api/_lib/telegram-*.js`                                   |
| Lembretes de contas     | Antes do vencimento e enquanto a conta estiver vencida (Telegram)                                          | `api/_lib/telegram-alertas.js`                             |
| Carteira sugerida       | O próximo aporte com o cálculo à vista, ativo por ativo. **Sugestão informativa**                          | `web/appliquei-motor-carteira.js`                          |
| Previsão de proventos   | Quanto os seus ativos devem pagar nos próximos 12 meses, mês a mês. **Estimativa, não garantia**           | `web/appliquei-aba-dividendos.js` (`projecaoProventos12m`) |
| Sonhos e metas          | Prazo e parcela calculados a partir da sua sobra real                                                      | `web/appliquei-sonhos.js`                                  |
| Simule sua liberdade    | Quanto juntar para viver de renda; comparação com o INSS                                                   | `web/appliquei-aba-simulador.js`                           |
| Relatório mensal        | Termômetro com quatro critérios, exporta em PDF                                                            | `web/appliquei-relatorio-mensal.js`                        |
| Jornada Financeira      | Oito módulos de estudo liberados em ordem                                                                  | `web/appliquei-jornada*.js`                                |
| Info Mercado            | Indicadores e notícias                                                                                     | `web/appliquei-aba-info-mercado.js`                        |
| Celular                 | Funciona como app e instala na tela de início                                                              | `web/appliquei-mobile.js`                                  |

**Não divulgar como pronto:** IA/chat/diagnóstico automático (Pro + IA),
Open Finance/sincronização automática com banco, saque de Applicash, app em
loja (App Store/Google Play).

## Personas

1. **"Já tentei planilha"** (principal) — 25 a 40 anos, CLT ou autônomo,
   ganha bem mas não sabe pra onde vai o dinheiro; abandonou planilha e apps
   que exigiam disciplina. Dor: fim do mês no aperto sem entender por quê.
   Gatilho: lançar pelo Telegram, aviso antes de apertar.
2. **"Comecei a investir e me perdi"** — já tem conta em corretora e Tesouro,
   investe um pouco por mês, não sabe se está indo bem nem onde aplicar o
   próximo aporte. Gatilho: patrimônio somado, carteira sugerida com o cálculo
   aberto, simulador.
3. **"Quero um sonho com data"** — tem um objetivo (viagem, carro, reserva,
   casamento) e não sabe quanto separar. Gatilho: Sonhos com prazo e parcela.

## Diferenciais (o porquê de pagar)

- **Tudo junto:** controle do mês + investimentos + patrimônio + metas no mesmo
  lugar (os concorrentes costumam fazer só um lado).
- **Avisa antes:** projeção de caixa e aviso de aperto, não só histórico.
- **Lançar sem abrir o app:** Telegram.
- **Conta aberta:** a sugestão de carteira mostra o cálculo; nada de caixa-preta.

## Concorrência (para posicionar, nunca para atacar pelo nome em anúncio)

- **Mobills** — controle financeiro, ~10 milhões de usuários, Premium
  R$ 99,90/ano (~R$ 8,40/mês). Forte em gastos, fraco em investimentos.
- **Organizze** — controle de gastos simples.
- **Kinvo / Investidor10 / Status Invest** — acompanhamento de investimentos,
  não cuidam do mês.
- **Apps de banco e corretora** — gratuitos, mas cada um vê só o próprio
  dinheiro.

Posicionamento: "o único lugar que olha o seu mês **e** os seus investimentos
juntos". Preço acima do Mobills — justifique com o que só a Appliquei faz.

## Números de mercado (para peças e pitch)

- 5,7 milhões de pessoas físicas na bolsa (B3, 2º tri/2026).
- 3,8 milhões de investidores ativos no Tesouro Direto (ago/2026), +22% em 12 meses.
- 19% dos brasileiros usam app de gestão financeira; 48% ainda usam planilha
  ou papel (Lina/MindMiners, 2026).
- Só 39% dizem sentir controle das próprias finanças (Creditas/Opinion Box, 2026).

Cite a fonte na legenda quando usar um número de pesquisa.

## Economia do cliente (para decidir quanto pagar por um cliente)

Do estudo de custos (out/2026, sem Applicash):

- Receita por cliente: R$ 15/mês.
- Sobra por cliente depois de Asaas e imposto: **~R$ 11,43/mês** (sem
  pró-labore) e ~R$ 12,85 (com pró-labore, a partir de ~126 clientes).
- Ponto de equilíbrio com o contador: ~8 clientes.
  Use isso para o CAC máximo em `calendario-e-metricas.md`.
