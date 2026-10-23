# Conteúdo das redes: estrutura

O plano completo, para ler e compartilhar, está em `plano-instagram.pdf`
(fonte: `plano-instagram.html`; gerar de novo com
`node marketing/conteudo/gerar-pdf.js`). O que publicar está em `CALENDARIO.md` (10 semanas até o lançamento, 3 posts
por semana + stories). As peças ficam nesta pasta, separadas pelo pilar da
skill de marketing (`.claude/skills/marketing-saas/referencias/calendario-e-metricas.md`):

| Pasta          | Pilar                               | % do total       | Para quê                                        | Formato                                                                                   |
| -------------- | ----------------------------------- | ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `alcance/`     | Dor e identificação + educação útil | ~60%             | Chegar a quem não segue (salvar e compartilhar) | Vídeo de 15–25 s no `modelo-alcance.html`                                                 |
| `educacao/`    | Educação financeira útil            | (dentro dos 60%) | Confiança e salvamentos                         | Carrossel de 6–8 lâminas (base: a Jornada do app)                                         |
| `bastidor/`    | Bastidor                            | ~10%             | Conexão (rosto, celular na mão)                 | Vídeo gravado pelo time, sem citar nome                                                   |
| `../<função>/` | Produto em ação                     | ~25%             | Converter quem já chegou ao perfil              | Os Reels narrados (teaser, carteira, Telegram, Sonhos, investimentos, patrimônio, resumo) |

Prova (depoimento) só quando houver depoimento real e autorizado.

## Alcance é educação primeiro (lição de 22/10/2026)

O fundador achou estranhos os dois primeiros vídeos de alcance (3 cobranças,
3 sinais de aperto): eles ainda vendiam os avisos do app, só com outra
embalagem. O que viraliza em finanças é **a pessoa aprender algo que muda uma
decisão dela hoje**: uma conta que surpreende, uma regra de bolso, um erro
comum. O app no máximo assina no fim ("Mais contas assim: siga o Appliquei").
Antes de produzir, pergunte: _se eu tirar a marca, o vídeo ainda vale a pena?_

Modelos:

- `modelo-conta.html` — **"conta na tela"** (padrão para alcance): gancho com
  duas opções, exemplo, a intuição comum, a virada com o número, a regra de
  bolso e "salva". Exemplo: `alcance/avista-ou-parcelado`.
- `modelo-alcance.html` — "lista de 3" sobre um extrato, com o app no fecho.
  Funciona melhor como **anúncio de diferencial** do que como alcance.

## Regras que valem para todas as peças

- **Identidade:** campo verde-escuro, malha fina, Figtree/DM Mono, verde-sinal
  `#34d399`, logo no canto e barra de progresso embaixo. Os modelos já trazem
  isso.
- **Voz:** sempre a Charon (`narrar-gemini.py`), com as perguntas subindo o
  tom no fim.
- **Antes de publicar:** rode o checklist de
  `.claude/skills/marketing-saas/referencias/voz-e-compliance.md`.
- **Nas peças de alcance, o app só aparece no fecho.** Nos últimos 3–5 s, com
  o aviso real do app que resolve a dor.
- **Um vídeo vira três:** publique o mesmo arquivo como Reels, TikTok e YouTube
  Shorts.
- **Medir:** retenção nos 3 s acima de 60%, assistido até o fim acima de 30% e
  salvamentos + compartilhamentos acima de 2% do alcance. O que ficar abaixo
  disso: mude só o gancho e publique de novo.

## Fazer um vídeo de alcance novo (≈1 pedido de voz)

```bash
D=marketing/conteudo/alcance/<tema>
mkdir -p $D && cp marketing/ferramentas/shorts/modelo-alcance.html $D/video.html
# 1. escreva as 6 frases em $D/narracao.json: gancho, item 1, item 2, item 3, CTA, fecho
ROTEIRO=$D/narracao.json python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
#    guarde /tmp/voz/leitura0.wav como $D/narracao-charon-leitura.wav e acerte os tempos
#    do narracao.json pela fala (o script imprime a duração de cada frase)
# 2. troque CONTEUDO e T no topo de $D/video.html (T = início de cada frase − 0,15 s)
python3 marketing/ferramentas/shorts/trilha-alcance.py $D/narracao.json /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" $D/trilha.wav
node marketing/ferramentas/shorts/render.js /tmp/r $D/video.html
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz $D/trilha.wav /tmp/r/video-sem-audio.mp4 $D/appliquei-<tema>.mp4
```

O modelo funciona para qualquer "lista de 3": 3 cobranças, 3 sinais de aperto,
3 erros no cartão. Para outro formato (antes/depois, mito × verdade), copie um
dos Reels de função como base.
