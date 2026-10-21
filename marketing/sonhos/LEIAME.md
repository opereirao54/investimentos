# Sonhos: Reels/Shorts de 30 s

Esta peça é da série de pré-lançamento "o que o app faz": uma funcionalidade
(Sonhos), para a persona "quero um sonho com data", com um único CTA: "Siga para
saber primeiro". A narração usa a voz padrão da marca (Charon, Gemini).

- `appliquei-sonhos-30s.mp4`: versão final narrada (-15 LUFS).
- `appliquei-sonhos-30s-sem-audio.mp4`: só a imagem.
- `sonhos-30s.html`: as cenas.
- `narracao.json`: a fala e os tempos de cada frase.
- `narracao-charon-leitura.wav`: a leitura aprovada.
- `trilha-sonhos.wav`: a trilha.

## Fiel ao produto

A tela do vídeo copia os textos de `web/appliquei-sonhos.js`:

- "Você vai precisar separar R$ X/mês em N aportes mensais — de agora até…";
- o veredito contra a sobra média ("Cabe, mas aperta" acima de 70% da sobra,
  "Cabe no seu mês com folga" até 70%);
- "E se o prazo fosse outro?";
- "Já lançar no Controle Financeiro", que cria o compromisso mensal na
  categoria ⭐ Sonho.

As parcelas são as calculadas pelo app (`calcSonhoMensal`): R$ 12.000 em
12 meses dá R$ 956,76/mês, e em 2 anos dá R$ 455,53/mês.

## Cuidados

- A parcela do app considera uma estimativa de rendimento de 0,8% a.m. Por
  isso a tela final avisa: "A parcela considera um rendimento estimado, não
  garantido". O vídeo não mostra a linha de juros nem promete retorno.
- Telas com dados de demonstração. O sonho e os valores são de exemplo.
- A promessa é de organização ("data marcada" = o prazo que a pessoa
  escolhe), não de enriquecimento.

## Legenda

> Qual é o seu sonho? ✈️🏠🚗
>
> Todo mundo tem um. Mas quase ninguém sabe quanto separar, nem quando ele
> chega. No Appliquei, você diz o sonho, o valor e o prazo, e vê quanto
> separar por mês e se isso cabe na sua sobra de verdade. Apertou? Veja o
> mesmo sonho em outro prazo. E a parcela já entra no seu mês, como qualquer
> conta.
>
> Chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Valores de exemplo (dados de demonstração). A parcela considera um
> rendimento estimado, não garantido.
>
> #financaspessoais #metasfinanceiras #organizacaofinanceira #educacaofinanceira #planejamentofinanceiro

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-sonhos.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/sonhos/trilha-sonhos.wav
node marketing/ferramentas/shorts/render.js /tmp/sonhos marketing/sonhos/sonhos-30s.html
ROTEIRO=marketing/sonhos/narracao.json LEITURA=marketing/sonhos/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/sonhos/trilha-sonhos.wav \
  /tmp/sonhos/video-sem-audio.mp4 marketing/sonhos/appliquei-sonhos-30s.mp4
```
