# Carteira sugerida — Reels/Shorts de 35 s

Peça de pré-lançamento da série "o que o app faz": uma funcionalidade (a
Carteira sugerida), persona "comecei a investir e me perdi", CTA único "Siga
para saber primeiro". Narração na voz padrão da marca (Charon, Gemini).

- `appliquei-carteira-sugerida-35s.mp4` — final, narrado (-15 LUFS).
- `appliquei-carteira-sugerida-35s-sem-audio.mp4` — só imagem.
- `carteira-sugerida-35s.html` — as cenas; `narracao.json` — fala e tempos;
  `narracao-charon-leitura.wav` — a leitura aprovada; `trilha-carteira.wav`.

## Cuidados jurídicos (CVM 19/20, CONAR, CDC)

- "Sugestão", nunca "recomendação"; nenhuma promessa de retorno.
- Nenhum ativo real: "Ação A", "FII B"... são fictícios e a tela diz
  "dados fictícios" o tempo todo. A divisão 40/32/25/3 é a do perfil Moderado
  do app e os cinco critérios são os pilares do motor.
- Os palpites riscados ("vai subir", "vende tudo") aparecem como o problema,
  nunca como fala da marca.
- Aviso falado e escrito no fim: informativo, não é recomendação, investimentos
  envolvem risco.
- **Só orgânico.** Enquanto "Carteira sugerida × CVM" estiver aberto em
  `docs/PENDENCIAS-LANCAMENTO.md`, não impulsionar como anúncio pago.

## Legenda

> Todo mês a mesma dúvida: onde investir o que sobrou? 🤔
>
> Dica de grupo, palpite de influenciador, um vídeo dizendo o contrário do
> outro... No Appliquei, você informa o seu perfil e quanto quer investir, e
> vê uma sugestão de divisão ativo por ativo, com a nota e os cinco critérios
> à vista. Sem caixa-preta. A decisão é sua.
>
> Chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Conteúdo informativo e educacional. Não é recomendação de investimento.
> Investimentos envolvem risco. Ativos e valores fictícios (dados de
> demonstração).
>
> #investimentos #educacaofinanceira #financaspessoais #comecarainvestir #organizacaofinanceira

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-carteira.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/carteira-sugerida/trilha-carteira.wav
node marketing/ferramentas/shorts/render.js /tmp/carteira marketing/carteira-sugerida/carteira-sugerida-35s.html
# mesma leitura, sem gastar cota (sem LEITURA= pede uma leitura nova ao Gemini)
ROTEIRO=marketing/carteira-sugerida/narracao.json LEITURA=marketing/carteira-sugerida/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/carteira-sugerida/trilha-carteira.wav \
  /tmp/carteira/video-sem-audio.mp4 marketing/carteira-sugerida/appliquei-carteira-sugerida-35s.mp4
```
