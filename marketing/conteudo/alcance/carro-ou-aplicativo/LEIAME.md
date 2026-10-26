# "Esse carro custa R$ 2.100 por mês. Parado na garagem." (72 s)

Vídeo educativo de alcance no formato "conta na tela" (`modelo-conta.html`),
na versão didática: abre com o número ("Esse carro custa R$ 2.100 por mês.
Parado na garagem. Quer ver a conta?") e explica cada custo antes de ele
entrar na nota, com uma legenda embaixo: (1) todo carro perde valor, R$ 80 mil
→ R$ 72 mil em um ano; (2) as contas fixas chegam rodando ou não; (3) o custo
que ninguém vê, o que os R$ 80 mil renderiam aplicados. Depois soma, divide
pelo preço da corrida (70 por mês) e compara com o uso real do Mateus (o mau
exemplo): 8 dias por mês, ida e volta, 16 corridas, R$ 480. Regra: se você
não chega nas 70 corridas, o carro é que pesa no bolso; se roda todo dia, pode
compensar. O app não aparece; a marca só assina. Personagem fictício.

- `appliquei-carro-ou-aplicativo-com-capa.mp4`: **o arquivo para postar**: a capa no primeiro
  quadro (0,1 s, vira a miniatura no TikTok e no Shorts) e embutida no arquivo.
- `appliquei-carro-ou-aplicativo.mp4`: final, narrado (-15 LUFS).
- `video.html`, `narracao.json`, `narracao-charon-leitura.wav`, `trilha.wav`
  (`trilha-alcance.py … --sem-moedas`).
- `capa.png` (`capa.json`): capa com a frase do gancho (`capa.js`).

## A conta (exemplo, conferida com fontes de out/2026)

Carro de R$ 80 mil, por ano, sem combustível:

| Item             | Valor         | Base                                                   |
| ---------------- | ------------- | ------------------------------------------------------ |
| Desvalorização   | R$ 8.000      | ~10% ao ano (estudo ValorFinal: R$ 8.500 p/ R$ 85 mil) |
| IPVA             | R$ 3.200      | 4%, alíquota de SP; outros estados cobram menos        |
| Seguro           | R$ 3.200      | 4% do valor (CNseg: 3% a 7%)                           |
| Manutenção       | R$ 1.200      | revisões (levantamentos: R$ 800 a 1.200)               |
| Deixou de render | R$ 9.600      | ~1% ao mês, com a Selic perto de 14% ao ano            |
| **Total**        | **R$ 25.200** | **R$ 2.100 por mês**                                   |

Sem o "deixou de render", o custo fica em ~R$ 1.300 por mês, que bate com os
estudos de 2026 (R$ 1.100 a 1.500 sem combustível). R$ 2.100 ÷ R$ 30 = 70
corridas por mês (2,3 por dia). Mateus: 8 dias × ida e volta = 16 corridas ×
R$ 30 = R$ 480.

A narração diz "pesa no bolso", nunca "caro": num vídeo sobre carro, "caro"
soou como "carro". A leitura é um take único (emendar frases de outro pedido
saiu 3–5 dB mais alto e com outro tom).

Os totais aparecem já no valor final (sem contador): um contador passava por
números intermediários que não batem com a nota.

A regra traz a ressalva: quem roda todo dia, a trabalho ou longe de tudo, pode
compensar ter carro. O vídeo não diz que carro é ruim.

## Legenda

> Esse carro custa R$ 2.100 por mês. Parado na garagem. 🚗
>
> O Mateus comprou um carro de R$ 80 mil porque achou que aplicativo pesava no bolso,
> mas só usa no fim de semana. Somando desvalorização, IPVA, seguro, manutenção
> e o que os R$ 80 mil deixam de render: R$ 25 mil por ano. Dá 70 corridas de
> R$ 30 por mês. O Mateus faz 16.
>
> 📌 Regra de bolso: divida o custo do seu carro pelo preço da corrida. Se você
> não anda tudo isso, o carro é que pesa no bolso. (Roda todo dia? Aí pode
> compensar. Faz a conta com o seu e comenta.)
>
> Manda pra quem acha que aplicativo pesa no bolso. 🔁
>
> Conteúdo educacional. Valores de exemplo para um carro de R$ 80 mil (IPVA de
> 4%, como em SP); seguro, desvalorização e manutenção variam por modelo e
> região. Supondo renda fixa perto de 1% ao mês. Personagem fictício.
>
> #educacaofinanceira #financaspessoais #carro #dinheiro #dicasdefinancas

**O que medir:** comentários (o tema divide opiniões, e comentário dá alcance),
compartilhamentos e salvamentos acima de 2% do alcance. Responda os
comentários com a conta, sem brigar.
