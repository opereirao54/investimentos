# Patrimônio: Reels/Shorts de 36 s

Esta é uma peça da série de pré-lançamento "o que o app faz". Mostra uma
funcionalidade (a aba Meu patrimônio) e tem um único CTA: "Siga para saber
primeiro". A narração usa a voz padrão da marca (Charon, Gemini).

- `appliquei-patrimonio-36s.mp4`: o vídeo final, narrado (-15 LUFS).
- `appliquei-patrimonio-36s-sem-audio.mp4`: só a imagem.
- `patrimonio-36s.html`: as cenas.
- `narracao.json`: a fala e os tempos.
- `narracao-charon-leitura.wav`: a leitura aprovada.
- `trilha-patrimonio.wav`: a trilha.

## Fiel ao produto

Os rótulos copiam o app:

- da aba Meu patrimônio (`Appliquei_v13.0.html`): "Patrimônio total", "Como
  ele está dividido", "Saldo em conta", "Total investido", "Imóveis" e
  "Veículos";
- dos bens (`web/appliquei-bens.js`): "Consultando FIPE…" e o quadro "Quanto do
  bem já é seu", com as linhas "O bem vale hoje", "Menos a dívida que falta" e
  "Já é seu";
- a linha do tempo mês a mês é a mesma que aparece no celular.

Os números fecham entre si. A soma 8.400 + 34.140 + 320.000 + 62.500 dá
425.040, e 320.000 − 186.300 dá 133.700. Os investimentos (R$ 34.140) são os
mesmos do vídeo de Meus investimentos.

## Cuidados

- O app não sincroniza com banco nem corretora (Open Finance não está pronto,
  ver `produto.md`). Por isso, na cena do número único, aparece "Você registra
  contas, investimentos e bens. O app junta tudo num número só.".
- Os valores de bens são estimativas (tabela FIPE e referência de R$/m²). O
  aviso final diz isso e que os dados são de demonstração.
- Não aparece banco nem montadora real: o carro é um "Hatch 2022 · exemplo".

## Legenda

> Se te perguntassem agora: quanto você tem, somando tudo? 🤔
>
> Conta no banco, investimentos, o carro, o apartamento… cada coisa num
> lugar diferente. No Appliquei, você registra tudo e vê um número só: o seu
> patrimônio. Quanto cada parte pesa, o carro pela tabela FIPE, o
> financiamento separado para você ver o que ainda deve, e a linha do tempo
> mês a mês.
>
> Chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Dados de demonstração. Valores de bens são estimativas (tabela FIPE e
> referência de R$/m²).
>
> #patrimonio #financaspessoais #organizacaofinanceira #educacaofinanceira #controlefinanceiro

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-patrimonio.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/patrimonio/trilha-patrimonio.wav
node marketing/ferramentas/shorts/render.js /tmp/patri marketing/patrimonio/patrimonio-36s.html
ROTEIRO=marketing/patrimonio/narracao.json LEITURA=marketing/patrimonio/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/patrimonio/trilha-patrimonio.wav \
  /tmp/patri/video-sem-audio.mp4 marketing/patrimonio/appliquei-patrimonio-36s.mp4
```
