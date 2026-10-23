# "Arthur investiu R$ 36 mil, Caio R$ 108 mil. Quem chegou aos 65 com mais?" (49,4 s)

Vídeo educativo de alcance no formato "conta na tela" (`modelo-conta.html`):
juros compostos com duas pessoas, a intuição comum ("o triplo, ele ganha"), um
"Errado." e as duas curvas, e então o "Por quê?": a regra dos 72 e uma escada
mostrando o dinheiro do Arthur dobrando sozinho (R$ 54 mil aos 35 → 108 → 216
→ 432 mil → R$ 544 mil aos 65). A segunda parte explica a primeira: o Caio
teve menos tempo para dobrar. O app não aparece. A marca só
assina ("Mais contas assim: siga o Appliquei"). Arthur e Caio são personagens
fictícios.

- `appliquei-comecar-cedo.mp4`: final, narrado (-15 LUFS).
- `video.html`, `narracao.json`, `narracao-charon-leitura.wav`, `trilha.wav`
  (`trilha-alcance.py … --sem-moedas`).

## A conta (conferida)

Supõe 8% ao ano acima da inflação, em valores de hoje (a mesma suposição do
módulo 1 da Jornada), com aporte no fim de cada mês e juros mensais
equivalentes (0,643% a.m.).

|        | Aportes                                 | Total aportado | Aos 65         |
| ------ | --------------------------------------- | -------------- | -------------- |
| Arthur | R$ 300/mês dos 25 aos 35, depois parado | R$ 36 mil      | **R$ 543.759** |
| Caio   | R$ 300/mês dos 35 aos 65                | R$ 108 mil     | **R$ 422.565** |

Com juros anuais, o Caio fica em ~R$ 408 mil e o Arthur no mesmo valor. A
história não muda.

**Regra dos 72:** 72 ÷ 8 = 9 anos para o dinheiro dobrar. O valor exato é
9,006 anos.

**Escada do Arthur (sem novos aportes depois dos 35):** R$ 54.037 aos 35,
R$ 108.021 aos 44, R$ 215.934 aos 53, R$ 431.653 aos 62 e R$ 543.759 aos 65.

## Legenda

> Arthur investiu R$ 36 mil. Caio, R$ 108 mil. Quem chegou aos 65 com mais? 🤔
>
> Arthur guardou R$ 300 por mês dos 25 aos 35 e parou. Caio guardou os mesmos
> R$ 300 dos 35 aos 65: o triplo de dinheiro. Mesmo assim, Arthur chega com
> R$ 544 mil e Caio com R$ 423 mil.
>
> Por quê? 📌 Regra dos 72: divida 72 pela taxa de juros ao ano e você descobre
> em quantos anos o dinheiro dobra. A 8% ao ano, 9 anos. Os R$ 54 mil do Arthur
> aos 35 viram 108, 216, 432 mil… sem ele pôr mais nada. O Caio teve menos
> tempo para dobrar.
>
> Manda para quem acha que ainda é cedo. 🔁
>
> Conteúdo educacional. Simulação supondo 8% ao ano acima da inflação, em
> valores de hoje: não é promessa de rendimento nem recomendação de
> investimento. Investimentos envolvem risco. Personagens fictícios.
>
> #educacaofinanceira #juroscompostos #investimentos #financaspessoais #dinheiro

**O que medir:** compartilhamentos (a meta é passar de 2% do alcance) e
comentários marcando amigos.
