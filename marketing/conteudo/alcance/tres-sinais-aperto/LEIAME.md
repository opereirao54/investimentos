# "3 sinais de que o seu dinheiro vai apertar este mês" (26,7 s)

Peça de alcance (pilar dor/educação), feita no `modelo-alcance.html`. Funciona
sem o app: a pessoa confere os três sinais na própria conta. O app só aparece
no fecho, com três avisos reais.

- `appliquei-tres-sinais-aperto.mp4`: final, narrado (-15 LUFS).
- `video.html`, `narracao.json`, `narracao-charon-leitura.wav`, `trilha.wav`.

## Fiel ao produto

Os avisos do fecho copiam o texto real:

- **Aperto:** "Entre 01/11 e 05/11, sai antes de entrar… Adiar um vencimento
  para depois de 05/11 resolve" (`web/appliquei-insights.js` e o Telegram).
- **Ritmo:** "Em outubro você já gastou… mais que setembro inteiro, e ainda
  faltam N dias" (`api/_lib/telegram-alertas.js`).
- **Limite:** "Você passou do limite de 60% da receita" (idem).

## A conta do exemplo fecha

Salário R$ 4.800, menos fatura R$ 1.640, menos parcelas R$ 710, menos outros
gastos R$ 1.130, deixa R$ 1.320 de saldo no fim do mês. No dia 1º vence o
aluguel de R$ 1.800, e a conta fica R$ 480 no vermelho até o salário do dia 5.
A revisão pegou a primeira versão sem a linha "Outros gastos", em que a conta
não fechava.

## Legenda

> 3 sinais de que o seu dinheiro vai apertar este mês 👇
>
> 1️⃣ A fatura do cartão já é maior do que sobra do salário
> 2️⃣ Parcelas novas se empilhando, uma em cima da outra
> 3️⃣ O aluguel vence antes do dia em que o dinheiro entra
>
> Viu algum? Salva para conferir todo mês e manda para quem precisa. 🔖
>
> O Appliquei chega em janeiro de 2027 e avisa o dia do aperto antes de
> acontecer. Siga para saber primeiro.
>
> Dados de exemplo.
>
> #financaspessoais #cartaodecredito #organizacaofinanceira #educacaofinanceira #dinheiro

**O que medir:** salvamentos e compartilhamentos (acima de 2% do alcance) e a
retenção nos 3 segundos.
