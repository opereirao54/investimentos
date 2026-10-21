# Lançar pelo Telegram — Reels/Shorts de 34 s

Peça de pré-lançamento da série "o que o app faz": uma funcionalidade (lançar
gastos pelo Telegram), persona "já tentei planilha", CTA único "Siga para
saber primeiro". Narração na voz padrão da marca (Charon, Gemini).

- `appliquei-telegram-34s.mp4`: versão final narrada (-15 LUFS).
- `appliquei-telegram-34s-sem-audio.mp4`: só imagem.
- `telegram-34s.html`: as cenas. `narracao.json`: fala e tempos.
  `narracao-charon-leitura.wav`: a leitura aprovada. `trilha-telegram.wav`: a trilha.

## Fiel ao produto

As respostas do bot no chat copiam o texto real de `api/_lib/telegram-bot.js`
(`descreverLancamento`, "marcado como pago") e de `api/_lib/telegram-alertas.js`
("Amanhã vence…", botão "✅ Já paguei"). "tênis" cai em Cuidados Pessoais e
"3x no cartão" vai para o cartão, como no `telegram-parser.js`. A IA de reserva
do bot não aparece, porque a IA não pode ser vendida como pronta (ver `produto.md`).

## Cuidados

- Sem marca de banco: a conta é "Conta corrente" e o cartão é "Cartão principal",
  para não sugerir parceria.
- O aviso final diz que o Telegram é marca de seu titular e não tem vínculo com o
  Appliquei, e que as telas usam dados de demonstração.
- Sem promessa de economia ou resultado. A peça mostra o processo, não um
  "antes e depois" financeiro.

## Legenda

> Você já desistiu de anotar seus gastos? ✍️
>
> Planilha esquecida, app que pede dez telas… No Appliquei, você manda
> "mercado 52,90" no Telegram e pronto: despesa lançada, com categoria e
> data. Parcelou? Ele divide na fatura. E ainda lembra das contas antes de
> vencer. Tudo aparece no seu mês, sem abrir o app.
>
> Chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Telas com dados de demonstração. Telegram é marca de seu titular, sem
> vínculo com o Appliquei.
>
> #financaspessoais #controlefinanceiro #organizacaofinanceira #educacaofinanceira #planilhadegastos

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-telegram.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/telegram/trilha-telegram.wav
node marketing/ferramentas/shorts/render.js /tmp/telegram marketing/telegram/telegram-34s.html
ROTEIRO=marketing/telegram/narracao.json LEITURA=marketing/telegram/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/telegram/trilha-telegram.wav \
  /tmp/telegram/video-sem-audio.mp4 marketing/telegram/appliquei-telegram-34s.mp4
```
