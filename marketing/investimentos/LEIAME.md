# Meus investimentos: Reels/Shorts de 33 s

Peça da série de pré-lançamento "o que o app faz": uma funcionalidade (a aba
Meus investimentos), para a persona "comecei a investir e me perdi", com um
único CTA: "Siga para saber primeiro". A narração usa a voz padrão da marca
(Charon, Gemini).

- `appliquei-investimentos-33s.mp4`: versão final, narrada (-15 LUFS).
- `appliquei-investimentos-33s-sem-audio.mp4`: só a imagem.
- `investimentos-33s.html`: as cenas.
- `narracao.json`: a fala e os tempos de cada frase.
- `narracao-charon-leitura.wav`: a leitura aprovada.
- `trilha-investimentos.wav`: a trilha.

## Fiel ao produto

Os rótulos copiam a aba do app (`Appliquei_v13.0.html`):

- "Investimentos hoje", "Ganho capital", "Capital aplicado · desde sua 1ª compra"
  e "Dividendos (3M)";
- as sub-abas Carteira, Operações, Dividendos e Futuro;
- na sub-aba Dividendos: "Recebido total", "Últimos 12 meses" e
  "Média mensal (12m)";
- na sub-aba Futuro: "Seu patrimônio em N anos · valores de hoje · sem colocar
  mais nada", com a régua de anos.

Os números fecham entre si:

- a corretora (R$ 18.240), o Tesouro (R$ 9.600) e o banco (R$ 6.300) somam
  R$ 34.140;
- os quatro ativos da lista somam o mesmo total;
- a divisão é 47% renda fixa, 33% ações e 20% FIIs.

## Cuidados

- Os ativos são fictícios ("Título público A", "Ação A", "FII A"), para não
  indicar ativo real (CVM 19/20).
- A projeção do Futuro é ilustrativa. O aviso final diz: "simulação com
  premissas, não garantia de rentabilidade; rentabilidade passada não garante
  a futura".
- O app não sincroniza com corretora nem com banco (Open Finance não está
  pronto, ver `produto.md`). Por isso a cena "tudo vira uma carteira só" traz
  o texto "Você registra cada compra. O app junta tudo e acompanha.".
- Telas com dados de demonstração.

## Legenda

> Você sabe quanto seus investimentos renderam este ano? 📈
>
> Um pouco na corretora, um pouco no Tesouro, outro tanto no banco… e cada
> app mostra só um pedaço. No Appliquei, você registra cada compra e tudo
> vira uma carteira só: quanto tem, quanto aplicou e quanto ganhou, ativo
> por ativo. Os dividendos, mês a mês. E a simulação de quanto isso vira se
> você não mexer em nada.
>
> Chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Ativos e valores fictícios (dados de demonstração). Projeção é simulação
> com premissas, não garantia de rentabilidade.
>
> #investimentos #carteiradeinvestimentos #dividendos #educacaofinanceira #financaspessoais

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-investimentos.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/investimentos/trilha-investimentos.wav
node marketing/ferramentas/shorts/render.js /tmp/invest marketing/investimentos/investimentos-33s.html
ROTEIRO=marketing/investimentos/narracao.json LEITURA=marketing/investimentos/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/investimentos/trilha-investimentos.wav \
  /tmp/invest/video-sem-audio.mp4 marketing/investimentos/appliquei-investimentos-33s.mp4
```
