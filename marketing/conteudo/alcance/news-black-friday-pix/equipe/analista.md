# Appliquei (@app.liquei): leitura dos Reels de 26/10 a 23/11

Analista do estúdio. Leitura feita na **seg 23/11, às 21h49 (horário de Brasília)**.
Os números vêm da Instagram Graph API v21.0 (/media + /insights), conta com
21 seguidores (eram 18 em 16/11). Dados brutos (sem token) em
`(pasta de trabalho da sessão) dados/ig.json`.

**Avisos antes dos números**

- **Amostra pequena.** Nenhum Reel passou de 400 views e o maior alcance é de 308
  pessoas. Tudo o que vem abaixo é padrão a observar, não conclusão.
- **Tarifas (23/11):** estava no ar havia **só ~3 h** na hora da leitura. Os números
  dele são parciais e não entram nas conclusões.
- **Duração do 13º (18/11) e do GTA (20/11):** não sei. Os arquivos não estão no
  repositório (o último commit é de 16/11), `api/_lib/reels-duracoes.json` não traz os
  dois e o proxy bloqueia o CDN do Instagram. Por isso a retenção deles está "?".
  Basta a duração dos dois (ffprobe ou o print) para fechar a conta.
- **Tarifas:** a duração de 51,2 s vem do arquivo do repositório, que é a versão
  anterior (Mateus × Caio, "66 dias"). O vídeo postado foi renderizado de novo com
  Beto e Lia, então a retenção dele é aproximada.
- O Reel do anúncio "Agora tem hora marcada" (29/10) não aparece mais na API
  (provavelmente arquivado).
- `follows` e `profile_visits` por Reel não saem pela API ("not supported").
  **Seguidores ÷ visualizações:** só dá para medir no perfil inteiro: +3 seguidores
  de 16/11 a 23/11, mais de 450 views novas no período, ou seja, ~0,6%.

## 1. Tabela dos Reels

Legenda das colunas:

- **Tempo** = `ig_reels_avg_watch_time`.
- **Ret.** = tempo médio ÷ duração.
- **Pulos** = `reels_skip_rate`.
- **Compart.** = compartilhamentos, com a % sobre o alcance.
- **Inter.** = `total_interactions`.
- Horários em Brasília.

| Data e hora       | Série    | Legenda (1ª linha)                                                   | Views   | Alcance | Salvos | Compart.     | Inter. | Tempo (s) | Dur. (s) | Ret.    | Pulos     |
| ----------------- | -------- | -------------------------------------------------------------------- | ------- | ------- | ------ | ------------ | ------ | --------- | -------- | ------- | --------- |
| seg 26/10 18h30   | Explica  | Mesma geladeira, mesmo cartão. Um teve 11 dias pra pagar, o outro 38 | 281     | 202     | 1      | 3 (1,5%)     | 17     | 7,7       | 39,3     | 20%     | **71,0%** |
| qua 28/10 18h30   | Explica  | Parcelado sem juros ou à vista com desconto?                         | 296     | 202     | 0      | 1 (0,5%)     | 15     | 4,8       | 32,6     | 15%     | 81,4%     |
| qui 29/10 12h30   | News #1  | O dólar teve a maior alta em 27 anos                                 | 212     | 149     | 0      | 1 (0,7%)     | 9      | 5,2       | 56,3     | 9%      | 79,5%     |
| sex 30/10 12h12   | Explica  | (carro) Appliquei Explica: a conta do dia a dia…                     | 255     | 204     | 0      | 1 (0,5%)     | 10     | 4,9       | 73,7     | 7%      | 84,2%     |
| seg 02/11 08h30\* | Explica  | Mateus investiu R$ 36 mil. Caio, R$ 108 mil. Quem chegou aos 65…     | 168     | 127     | 0      | 0            | 9      | 10,2      | 51,1     | 20%     | 80,6%     |
| qua 04/11 18h06   | News     | O banco te paga R$ 7 e te cobra R$ 153                               | 169     | 142     | 0      | 3 (2,1%)     | 11     | 5,0       | 47,6     | 11%     | 78,8%     |
| sex 06/11 06h00\* | Explica  | O salário cai até amanhã                                             | 24      | 7       | 0      | 0            | 2      | 12,7      | 47,1     | 27%     | 88,9%     |
| seg 09/11 19h00   | Explica  | Só mais R$ 40 na parcela pra proteger a TV                           | 158     | 120     | 0      | **4 (3,3%)** | 9      | 6,8       | 40,0     | 17%     | 83,8%     |
| qua 11/11 18h51   | News     | Dia 9/12 o tanque pode ficar R$ 35 mais caro                         | **369** | **308** | 0      | 1 (0,3%)     | 8      | **11,2**  | 35,4     | **32%** | 78,4%     |
| sex 13/11 18h40   | Explica  | Sexta-feira 13: tem uma cobrança assombrando o cartão do Beto        | 297     | 235     | 0      | 2 (0,9%)     | 6      | 5,3       | 35,3     | 15%     | 75,6%     |
| seg 16/11 18h30   | Explica  | Esse 50% off pode ser o preço de outubro                             | 144     | 107     | 0      | 1 (0,9%)     | 6      | 3,4       | 36,9     | 9%      | 84,3%     |
| qua 18/11 19h00   | News     | Ganha até R$ 5 mil? Seu 13º vem R$ 240 mais gordo                    | 103     | 74      | 0      | 1 (1,4%)     | 7      | 6,9       | ?        | ?       | 77,8%     |
| sex 20/11 12h00\* | especial | Quanto custa viver o GTA na vida real?                               | 131     | 109     | 0      | 0            | 1      | 8,7       | ?        | ?       | **47,7%** |
| seg 23/11 18h30   | Explica  | Você pode estar pagando tarifa à toa                                 | 79      | 64      | 0      | 2 (3,1%)     | 3      | 2,5       | ~51      | ~5%     | 89,0%     |

\* Fora das 19h ou fora da grade: não entram na comparação de abertura (regra da
`analise-metricas.md`). Tarifas: ~3 h no ar, parcial.

**O que a tabela mostra**

- **Salvos:** 1 em 14 Reels, sempre ~0%.
- **Comentários:** 0 em todos desde 09/11.
- **Pulos:** 71 a 89% em todos, menos o GTA.
- **Alcance:**
  - de 26/10 a 13/11: 120 a 308 por Reel;
  - de 16/11 em diante: 64 a 109.
  - O alcance caiu.

## 2. Os dois testes contra a linha de base (5,6 s; 14%; meta 10 s e 30%)

### Abertura nova (desde 04/11)

Entram na conta os Reels da grade postados perto das 19h: Copom, garantia,
gasolina, sexta 13, Black Friday, 13º e tarifas. Ficam de fora:

- o do salário (saiu às 6h);
- o GTA (especial, saiu às 12h).

|                                      | Linha de base (04/11) | Antes de 04/11, hoje (5 Reels) | Abertura nova (7 Reels)             |
| ------------------------------------ | --------------------- | ------------------------------ | ----------------------------------- |
| Tempo médio (média)                  | 5,6 s                 | 6,6 s                          | 5,9 s                               |
| Tempo médio (mediana)                | —                     | 5,2 s                          | 5,3 s                               |
| Retenção (média dos que têm duração) | 14%                   | 14%                            | 15% (mediana 13%)                   |
| Pulos (média)                        | —                     | 79,3%                          | 81,1%                               |
| Reels que bateram a meta             | —                     | 0 de 5                         | **1 de 7** (gasolina: 11,2 s e 32%) |

**Resultado:** a abertura nova **não deu certo** como regra.

- A média ficou igual à linha de base (5,9 s contra 5,6 s; 15% contra 14%).
- Os pulos não caíram (81% contra 79%).
- Só a gasolina bateu a meta. A Black Friday seguiu "a receita da gasolina" (número
  em movimento desde o quadro 0, sem vinheta, ~37 s) e fez **3,4 s, 9% e 84% de
  pulos**, o 2º pior do perfil. Então o que segurou a gasolina não foi a estrutura
  da abertura.
- Também pesou a fonte. No print de 12/11, 52,5% das views da gasolina vieram de
  Stories (o fundador compartilhou), e quem chega por ali é público mais quente.

### Legenda sincronizada (desde o News de 18/11)

Só há **um Reel limpo**, o 13º (News, 19h). Ele fica entre os dois Reels de comparação:

| Reel                             | Tempo     | Ret. | Pulos     |
| -------------------------------- | --------- | ---- | --------- |
| Gasolina (sem legenda)           | 11,2 s    | 32%  | 78,4%     |
| Black Friday 16/11 (sem legenda) | 3,4 s     | 9%   | 84,3%     |
| **13º (com legenda)**            | **6,9 s** | ?    | **77,8%** |

**Resultado:** **ainda sem resposta, e por enquanto não bate a meta.**

- O 13º fez 6,9 s, abaixo dos 10 s.
- A retenção depende da duração. Se o vídeo seguiu a regra do News (30 a 45 s), ficou
  entre 15 e 23%, abaixo dos 30%. Isso é conta, não medida: falta a duração.
- Os pulos de 77,8% empatam com a gasolina. Melhoram 6,5 pontos sobre a Black Friday,
  mas ficam dentro da faixa normal do perfil (71 a 89%).
- Não sei se o GTA e o tarifas saíram com a legenda. A versão do tarifas que está no
  repositório não tem legenda (abre com 2,5 s de vinheta).

**Para fechar o teste:**

- 2 ou 3 News a mais com a legenda;
- a duração de cada um;
- o print da curva dos 3 primeiros segundos.

## 3. O que os melhores têm em comum, e por que o GTA pulou menos

Os 4 melhores por tempo médio ou por pulos:

| Reel      | Tempo  | Pulos |
| --------- | ------ | ----- |
| Gasolina  | 11,2 s | 78%   |
| 65 anos   | 10,2 s | 81%   |
| GTA       | 8,7 s  | 48%   |
| Geladeira | 7,7 s  | 71%   |

Garantia é o melhor em compartilhamentos (3,3%).

**O que eles têm em comum** (padrão, amostra pequena):

1. **Uma coisa concreta e desejada ou ameaçada logo na 1ª frase:** o tanque, a geladeira,
   o patrimônio aos 65, a mansão e o carro. Os piores abrem com uma instituição ou um
   conceito: o banco (R$ 7, tarifas), "parcelado ou à vista?", o dólar.
2. **Um gancho preso ao calendário:** "dia 9/12" (gasolina), "Sexta-feira 13", 13º, o
   lançamento do GTA VI.
3. **Não parecem anúncio.** Os dois piores da grade abriam com cara de propaganda:
   - a Black Friday com uma etiqueta "50% OFF / R$ 2.000";
   - o tarifas com o cartão "Tarifa R$ 0", e na versão do repositório com a vinheta
     "APPLIQUEI EXPLICA" de 0,5 a 3 s.

   Tela de oferta é o que a pessoa já aprendeu a pular no feed. Isto é hipótese, não
   medida.

**Por que o GTA teve ~48% de pulos contra 71 a 89% dos outros** (hipóteses, sem dado
para separar o peso de cada uma):

- **Era o assunto do momento.** O GTA VI estava marcado para sair em 19/11/2026
  ([PCGamesN](https://www.pcgamesn.com/gta-6-release-date),
  [ESPN](https://www.espn.co.uk/gaming/story/_/id/44965809/grand-theft-auto-vi-gta-6-release-date))
  e o Reel saiu no dia seguinte, com #gta6. Quem vê "GTA" no auge do lançamento para
  por reconhecer o tema, não pela conta.
- **Promete espetáculo, não lição.** "Quanto custa viver o GTA na vida real?" é uma
  curiosidade com imagens de desejo (mansão em Miami, superesportivo, helicóptero). Ele
  não abre com "você está perdendo dinheiro".
- **Pode ter chegado a outro público.** As hashtags de game devem ter levado o Reel a
  um público que não é o de finanças. Isso precisa do print das fontes, que eu não tenho.
- **Horário diferente:** saiu às 12h, não às 19h.

**O outro lado do GTA:**

- 0 compartilhamentos, 0 salvos, 0 comentários (pedia "comenta") e 1 curtida;
- alcance de 109, na média recente;
- prendeu o olhar, mas não converteu nem combinou com a promessa do perfil.

**A lição que vale levar:** o "pare" no 1º segundo vem de um **assunto que a pessoa já
reconhece e quer ver**, não da estrutura da abertura. Vale tentar a ponte "assunto
quente → conta do bolso" dentro do formato da marca. Se o especial se repete, é decisão
do fundador.

**Diagnóstico em 1 frase:** o perfil perde ~80% das pessoas antes de 1 segundo porque
o 1º quadro parece aula ou anúncio sobre um assunto que a pessoa não reconhece. E
quem fica não salva nem segue, porque o pedido vem no fim, quando quase ninguém está
mais lá.

## 4. Três mudanças propostas para o News de qua 25/11

O tema é decisão do fundador. O calendário sugere a Black Friday com outro ângulo
(frete e juros no preço final, lista "Evite esses sites" do Procon-SP).

São três testes, **um por News**. A proposta é aplicar só o 1º em 25/11 e os outros
nos News seguintes, se o fundador aprovar. A legenda sincronizada continua em todos,
porque o teste dela ainda está aberto e assim ela não vira uma segunda variável.

1. **(25/11) Primeiro quadro sem cara de anúncio, com a cena da pessoa.** Nada de
   etiqueta "% OFF" nem de cartão de preço no quadro 0.
   - **Como:** abrir com a situação de quem assiste: o carrinho no celular, "frete
     R$ 39,90" aparecendo, o total subindo. O número entra em movimento na 1ª frase
     ("Os R$ 199 da promoção viram R$ 260 no fim do carrinho").
   - **Medida:** pulos abaixo de 75% (hoje a média é 81%) e tempo médio acima de 7 s,
     contra a Black Friday de 16/11 (84%, 3,4 s).
2. **(02/12) Gancho num assunto que a pessoa reconhece no 1º segundo**, a lição do GTA
   levada para o formato da marca.
   - **Como:** a 1ª linha e o 1º quadro trazem o nome do assunto quente da semana
     (ex.: um jogo, uma série, um evento, a "Black Friday"), e a conta vem logo depois.
   - **Medida:** pulos abaixo de 70%.
   - **Atenção:** precisa ser popular e apartidário, como o combinado já exige.
3. **(09/12) O pedido de envio e o "segue" antes dos 10 s.** Hoje eles entram perto dos
   30 s, quando ~5 a 15% ainda estão vendo, e o resultado é 0 salvos e ~0 seguidores.
   - **Como:** uma frase curta depois da 1ª conta ("Manda pra quem tá com o carrinho
     cheio"), mantendo a de fecho.
   - **Medida:** compartilhamentos acima de 1,5% do alcance e seguidores no dia.
   - **Atenção:** em 13/11 o pedido de envio aos ~17 s foi testado junto com outra
     mudança e não deu para separar os efeitos. Aqui ele vai sozinho.

**Correções que não contam como teste (combinado já existente):**

- **Postar às 19h:** o GTA saiu às 12h e o tarifas e a Black Friday às 18h30.
- **Registrar a duração** de cada Reel em `reels-duracoes.json`, porque sem isso a
  retenção do 13º e do GTA não fecha.
- **Mandar o print** "Estatísticas" do 13º e do GTA, com as fontes e a curva dos 3 s.
- **Ver se o tarifas saiu com a vinheta antiga** de 0,5 a 3 s. Se saiu, isso explica
  os 89% de pulos.
- **Fixar um comentário** com pergunta: desde 09/11 nenhum Reel teve comentário.

## Onde registrar (proposta, não feito)

O repositório da Appliquei é só leitura para mim. O produtor ou o fundador decidem se
entra em `marketing/metricas/LEIAME.md`:

- o resultado da abertura nova: não bateu, 1 de 7;
- a legenda sincronizada: 1 Reel, sem resposta ainda;
- a hipótese "assunto reconhecível > estrutura da abertura".

Nada foi escrito no estúdio do "Isso é verdade?" (outra página).
