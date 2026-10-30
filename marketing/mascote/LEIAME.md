# Mascote: Pingo

O próprio "$" da logo (o que fica no pingo do "i" de Appliquei) virado
personagem: o corpo é o desenho do cifrão de `appliquei-wordmark.svg`, um
pouco mais encorpado para o rosto caber na faixa do meio, com braços e pés.
Escolhido em 28/10/2026, depois que a primeira versão (uma gota verde) foi
recusada pelo fundador por não lembrar dinheiro ("parecia o Zé Gotinha").

- **Personalidade:** a voz da marca. Calmo, direto, faz a conta com você.
  Nunca promete ganho nem indica investimento (CVM e CONAR).
- **Poses** (`pingo/pingo-<pose>.svg`): feliz (padrão), acenando (abertura),
  apontando (regra de bolso), pensando (pergunta do gancho), alerta ("antes
  de apertar") e comemorando (meta batida).
- **Folha de apresentação:** `pingo/folha.png` (poses, o Pingo em pé no "i"
  da marca, tamanho de ícone e um Reel).
- **Gerar de novo:** `node marketing/mascote/gerar-pingo.js` (SVG puro, cores
  da marca; ajuste formas e poses no próprio script).

**Quando usar (sugestão, aguardando o fundador):** fora da série atual, que
já tem visual estabelecido. Estreia na semana do lançamento (26/12 a 02/01)
como o "rosto" do app.

## 3 estilos (28/10)

`node marketing/mascote/sugestoes.js` gera `pingo/sugestoes.png` e os SVGs em
`pingo/estilos/`: **1 Minimalista** (o "$" da logo quase sem mudança, só o
rosto), **2 Fofo** (olhão, luvas brancas e tênis) e **3 Descolado** (boné pra
trás, óculos escuros e joinha). Aguardando a escolha do fundador.

## Animação dos 3 estilos (28/10)

`animacao/pingo-3-estilos.mp4` (22 s, 1080×1920, sem som): cada estilo cai,
pisca, acena e pula; no fim, os três juntos. O corpo foi **redesenhado com
traço limpo** nas proporções do "$" da logo (o contorno da logo é escaneado e
ficava torto ao engrossar; o fundador achou que o "S" destoava). Gerar de
novo: `node marketing/ferramentas/shorts/render.js <pasta>
marketing/mascote/animacao/video.html`.

## Ilustrados (28/10)

O fundador não gostou do Pingo em nenhum estilo. `node
marketing/mascote/ilustrados.js` gera a **Capivara** (moletom verde e
caderninho) o **Caramelo** (bandana verde e moeda) e o **João-de-barro** (capacete de obra verde, tijolinho e a casinha de barro) em ilustração plana:
`ilustrados/folha.png`. Para ilustração 3D de qualidade, usar os prompts de
`prompts-ideias.md` num gerador de imagem.
