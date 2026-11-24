# Editor: News "Black Friday: vai pagar no Pix?" no padrão real da Appliquei

Fonte (só leitura): `este repositório` (COMBINADOS.md, shorts/LEIAME.md,
capa.js, contagem.js, vinheta.sh, vinheta-news.html, render.js, e os News reais
`conteudo/alcance/gasolina-imposto/video.html` e `black-friday-preco/video.html`).

## O rascunho versus o padrão (o que mudou no montar.py)

| Item                                     | Rascunho                                                         | Padrão Appliquei (aplicado)                                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fundo                                    | #07261b / #0b3526 radial, grade 90 px a 7%                       | `linear-gradient(150deg,#0b1410,#0f1f18 50%,#112720)` + halo `rgba(16,185,129,.22)` / `rgba(5,150,105,.18)`, malha 60 px `#f0faf4` a 3%                                                                                             |
| Cores                                    | verde #13a65f, vermelho #d7262e, amarelo #f7c933, branco #f4f7f5 | tinta #f0faf4, deck #c8d6cf, mudo #9fb3aa, sinal #34d399, primária #059669, âmbar #fbbf24, vermelho #f87171, azul #60a5fa, **vermelho News #b91c1c**                                                                                |
| Fontes                                   | Poppins + IBM Plex Mono                                          | **Figtree** 900 (títulos, legenda) e **DM Mono** 400/500 (rótulos, números, selo). Syne só no site. Arquivos locais em `video/assets/fonts/` (Google Fonts, OFL)                                                                    |
| Logo                                     | texto "Appliquei$" em Poppins                                    | **`appliquei-wordmark.svg`** (letras #f0faf4, $ #10b981), cópia em `video/assets/wordmark.svg`. Não usar `appliquei-logo.svg` (fundo branco e letras azul-marinho, feito para fundo claro)                                          |
| Topo                                     | marca em 90/190, selo em right 130 / top 196                     | wordmark left 60, top 60, 200 px; tarja pílula "APPLIQUEI NEWS" right 150, top 60 (DM Mono 22 px, #b91c1c, branco); some na capa                                                                                                    |
| Selo                                     | pílula amarela simples                                           | CSS idêntico ao `contagem.js`: x = W−w−60, y = 130, fundo rgba(11,20,16,.82), borda 2 px #fbbf24, texto #fde68a DM Mono 28 px, número #fbbf24 34 px, ponto 12 px. Fica também na capa (como o contagem.js faz). `DIAS=38` (env)     |
| Faixa "APPLIQUEI NEWS" no meio da cena 1 | faixa girada -6°, #d7262e                                        | saiu; a cena 1 virou título "De cada R$ 100 perdidos no Pix, menos de R$ 10 voltam" + barras (#f87171 / #fbbf24, contador 0 → R$ 9,30 quando "menos de dez" é dito)                                                                 |
| Papel do Procon                          | branco liso                                                      | card de manchete dos News: #f4f4f0, barra #b91c1c, sombra 10px 12px 0 rgba(0,0,0,.55); "Procon-MG · dicas para compras online"                                                                                                      |
| Legenda                                  | pílula preta, centro ≈ y 1390, destaque amarelo                  | igual ao render.js: centro **y 1430** (top 1370, altura 120), fundo rgba(6,12,9,.78), raio 24, Figtree 900 66 px, destaque #34d399. Nenhuma cena usa 1340–1520                                                                      |
| Quadro 0                                 | celular com "-64% só hoje", preço riscado, tag "oferta"          | checkout "FINALIZAR COMPRA · Smart TV 55" · TOTAL R$ 899" e o dedo indo para "PAGAR COM PIX" (pedido do analista)                                                                                                                   |
| Fim                                      | fontes soltas + "Appliquei$"                                     | wordmark 440 px + "Mais contas assim: siga o Appliquei" + caixa `.aviso` dos News (fontes do pauteiro + "Conteúdo educacional, não é recomendação. Valores da TV de exemplo, loja fictícia.") acima da faixa da legenda             |
| Capa (últimos 0,7 s)                     | faixa girada + celular                                           | `capa.js` com `"news": true`: faixa #b91c1c 300 px em top 300, skewY(-4°), APPLIQUEI 124 px Figtree 900, NEWS DM Mono 70 px em caixa branca; frase 104 px a partir de y 660 (âmbar no "Pix?"), apoio 44 px #c8d6cf, wordmark 300 px |
| Cortes                                   | flash branco                                                     | flash na cor do fundo (#0b1410), 0,18 s                                                                                                                                                                                             |
| Barra de progresso                       | não tinha                                                        | `.barra-t` 8 px embaixo, #059669 → #34d399 (como nos Reels)                                                                                                                                                                         |

## Capa no 1º quadro e vinheta (juntar.sh)

`appl/juntar.sh <render-hf-mixado.mp4> <saida.mp4>` faz o que o `vinheta.sh` + `contagem.js` fazem, sem
Playwright: tira o último quadro (a capa) em PNG, monta
`[capa 0,1 s][episódio até 2,52 s][vinheta-news.mp4 1,6 s][resto]`, atrasa o áudio 100 ms (igual ao vinheta.sh),
embute a capa (attached_pic) e faz a **única compressão final no perfil C** (10 Mbps, preset slow,
tune animation, unsharp leve, BT.709). O ponto do corte sai do `video/corte.json` (meio da pausa entre o
gancho e a fala 1). `VINHETA=0` tira a vinheta. Só a sintaxe foi checada; a execução foi bloqueada aqui
(sem render), então precisa de um teste antes de valer.

Atenção: os últimos News (gasolina 11/11, Black Friday 16/11) saíram **sem vinheta** depois da lição
dos 86% de pulos; o combinado aceita "depois do gancho (~3 s) ou fora". É decisão do fundador.

## Personagens e formato

Sem personagens no roteiro, então nada de "Personagens fictícios". Beto × Lia é o formato
do Explica; no News é opcional (o da gasolina usou). Se quiserem: Beto paga no Pix numa loja
que não conhece, Lia paga com o cartão virtual. Aí o aviso ganha "Personagens fictícios."

## Outros achados

- A voz do rascunho era **Achird**; a marca usa só **Charon** ou **Sulafat**. A pasta `charon/` resolve isso.
- O `partes.json` do Charon (00:50) já tem a fala 1 nova; o montar.py foi gerado e conferido com ele.
- Pix (#32bcad) aparece só no botão do checkout fictício.

## Reaproveitar o pipeline deles ou ficar no HyperFrames?

Ficar no **HyperFrames para o episódio** e reaproveitar **os ativos e as regras** deles: vinheta-news.mp4
pronta, tokens do capa.js e do contagem.js copiados para o HTML, e a montagem/compressão do
vinheta.sh/contagem.js no `juntar.sh`. Rodar render.js/capa.js/contagem.js direto não dá aqui: pedem
`node_modules/playwright` e `.fontes.css` dentro do repositório deles, que é só leitura e não tem nenhum dos dois.
Para gerar no repo deles depois: `npm ci` + `./marketing/fontes.sh`, e o `index.html` vira `video.html` com `render(t)`.

## Próximos passos

1. `cd appl && python3 montar.py charon`, depois `cd video && hf render` (qualidade alta) e mixar com `charon/trilha.wav`.
2. `./juntar.sh <mixado.mp4> appliquei-news-bf-pix.mp4`, depois a folha de contato do MP4 final
   (quadro 0 = capa, 0,1 s, 2,5 s = vinheta, contador em ~6,5 s, cortes, último quadro) e o recorte 3:4 da capa.

Quadros conferidos: `appl/snap2/contact-sheet.jpg` (0; 2,4; 4,5; 7,5; 11; 16; 20,5; 23,5; 25,2 s) e `appl/snap3/`.
