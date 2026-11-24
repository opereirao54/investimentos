# "Black Friday: vai pagar no Pix?" (25,7 s) · Appliquei News

Reel de **qua 25/11/2026** (faltam 38), 19h, Instagram, TikTok e YouTube Shorts.
Tema e rascunho aprovados pelo fundador em 23/11 ("Rascunho aprovado"); versão
**sem vinheta** e com o aviso "Valores da TV de exemplo, loja fictícia."
(fundador, 23/11). Voz Charon. Troca o ângulo da Black Friday, como pedia o
calendário (a "metade do dobro" saiu em 16/11).

Feito pela equipe do estúdio de vídeo (pauteiro, analista, algoritmo, editor,
sonoplasta), com os relatórios em `equipe/`.

- `../../publicar/10-25-11-news-black-friday-pix.mp4`: **o arquivo para postar**
  (capa no 1º quadro, selo "Faltam 38 dias", sem vinheta) e `-capa.png`.
- `video.html` + `assets/` (GSAP, wordmark, Figtree e DM Mono locais): a
  composição em HyperFrames. `montar.py` gera o HTML a partir da pasta da voz;
  `juntar.sh` põe a capa no 1º quadro e faz a compressão final no perfil do
  `contagem.js` (`VINHETA=0` = sem vinheta, como foi ao ar).
- `narracao.json` (roteiro, voz Charon), `narracao-charon-leitura.wav` (take
  aprovado: `LEITURA=` refaz os cortes sem gastar cota), `trilha.wav`, `capa.png`.

## Roteiro

| s    | Fala                                                                                    | Tela                                                                                    |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0    | Black Friday: você vai pagar no Pix?                                                    | checkout "Finalizar compra" com o dedo indo para PAGAR COM PIX (sem etiqueta de oferta) |
| 2,7  | Se cair em golpe, de cada cem reais perdidos no Pix, menos de dez voltam pra sua conta. | barras R$ 100 perdidos × contador até R$ 9,30 "volta, em média"                         |
| 8,8  | No cartão de crédito, dá pra contestar a compra e pedir o estorno.                      | cartão + "estorno pedido"                                                               |
| 12,5 | Por isso o Procon orienta: em loja que você não conhece, cartão, não Pix.               | papel do Procon-MG com grifo; ✓ cartão ✗ Pix                                            |
| 18,3 | E de preferência o cartão virtual, do app do banco.                                     | cartão virtual com número trocando                                                      |
| 21,8 | Manda pra quem vai comprar na sexta.                                                    | CTA, "siga o Appliquei", fontes e aviso                                                 |
| 24,9 | (capa 0,7 s)                                                                            | faixa vermelha APPLIQUEI NEWS                                                           |

## Os números

| Dado                                  | Valor                                                                        | Fonte                                     |
| ------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| Devolvido em golpes no Pix            | em 2025, em média 9,3% do valor contestado ("menos de R$ 10 de cada R$ 100") | Banco Central, apresentação do MED 2.0    |
| Contestar no cartão                   | chargeback / estorno pela operadora                                          | regra do cartão de crédito                |
| Cartão, não Pix, em loja desconhecida | orientação para compras online                                               | Procon-MG (Vox MPMG)                      |
| Cartão virtual                        | orientação dos bancos para compras online                                    | matérias com dicas da Febraban (nov/2025) |
| TV R$ 899                             | valor de exemplo, loja fictícia                                              | —                                         |

**Trocado na checagem:** o rascunho dizia "os bancos só devolveram R$ 8,90"
(O Povo, 24/07/2026). Era uma conta do jornal, não dado do BC; saiu.
Pendências do pauteiro: abrir os links do BC e do Procon-MG antes de reusar
(o proxy bloqueou as páginas; os dados vieram dos trechos da busca).

## O que mudou na abertura (proposta do analista, aprovada no rascunho)

O Black Friday de 16/11 abriu com etiqueta de preço e teve 3,4 s de tempo
médio e 84% de pulos. Este abre com a **cena de quem assiste** (o dedo indo
apertar o Pix), pergunta falada e escrita no segundo 0, sem etiqueta nem
"% OFF", e sem vinheta.

**O que medir (48 h):** pulos e tempo médio contra o Black Friday de 16/11
(3,4 s, 84%) e a gasolina (12 s, 76%); compartilhamentos (pedido "pra quem vai
comprar na sexta"); a origem das views (Stories × aba Reels).
