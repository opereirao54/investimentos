# Calendário até o lançamento: duas séries de Reels, de 26/10/2026 a 02/01/2027

**Objetivo:** fazer a pessoa seguir a página (educação e planejamento
financeiro) e criar expectativa pelo lançamento de **02/01/2027**, sem mostrar
o app antes da última semana. Cada vídeo resolve uma dor real e termina com
uma pista do que vem.

PDF simples para compartilhar: `plano-instagram.pdf` (fonte
`plano-instagram.html`; gerar com `node marketing/conteudo/gerar-pdf.js`).

## Regras

- **Duas séries, só Reels (fundador, 29/10; grade de 04/11):** **Appliquei
  Explica** (seg e sex; os temas da tabela abaixo) e **Appliquei News** (qua;
  a notícia econômica do momento traduzida para o bolso, tema escolhido na
  véspera). 3 Reels por semana a partir de 04/11 e todo dia de 27/12 a 02/01.
- **Sem stories** desde 29/10.
- **Contagem regressiva em todo Reel:** selo "Faltam X dias" no canto e a
  linha "⏳ Faltam X dias…" na legenda.
- **Até 26/12 o app não aparece.** As pistas falam do que a pessoa vai
  sentir, não de telas. Na última semana, os 7 vídeos de produto revelam o
  app função por função.
- **Formato:** "conta na tela" (`modelo-conta.html`), voz Charon, Caio (bom
  exemplo) e Mateus (mau exemplo), capa com a frase do gancho (`capa.js`),
  aviso educacional e números conferidos com fonte antes de gravar.
- **Sem urgência ou escassez inventadas** (CONAR). "Lista de espera" só se
  existir de verdade.
- **Carteira sugerida** fora da série enquanto a pendência CVM estiver aberta
  (`docs/PENDENCIAS-LANCAMENTO.md`).
- **Ao publicar:** marque ✅ na coluna "Publicado" e anote retenção em 3 s,
  assistido até o fim, salvamentos e compartilhamentos.

## As quatro fases

| Fase                             | Datas         | Tema                                                       | O que a pessoa sente           |
| -------------------------------- | ------------- | ---------------------------------------------------------- | ------------------------------ |
| 1. Abrir os olhos                | 26/10 a 13/11 | Custos invisíveis do dia a dia                             | "Eu perdia dinheiro e não via" |
| 2. Organizar                     | 16/11 a 27/11 | Divisão do salário, reserva, Black Friday, 13º             | "Dá pra controlar"             |
| 3. Fazer crescer e planejar 2027 | 30/11 a 26/12 | Juros compostos, inflação, Natal, contas de janeiro, metas | "Quero começar"                |
| 4. Lançamento                    | 27/12 a 02/01 | O app, função por função                                   | "É isso que eu precisava"      |

## Grade desde 04/11 (fundador): seg Explica · qua News · sex Explica

Três Reels por semana, às 19h, **sempre com a contagem regressiva** (selo
"Faltam X dias" no vídeo e a linha "⏳ Faltam X dias…" na legenda). De 27/12 a
02/01 continua a reta final diária com os vídeos do app (série Appliquei).

✅ pronto · 🆕 a fazer · 📤 publicado

### Já publicados (grade antiga)

| Data      | Série   | Reel                                               | Publicado                                                                             |
| --------- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| seg 26/10 | Explica | Mesma compra: 11 ou 38 dias pra pagar?             | 18h30 · 188 views · ret. 20% · compart. 1,4%                                          |
| qua 28/10 | Explica | Parcelado sem juros ou à vista com desconto?       | 18h30 · 292 views · ret. 15% · compart. 0,5%                                          |
| qui 29/10 | News #1 | O dólar disparou. E o seu pãozinho?                | 12h30 · 208 views · ret. 9% · compart. 0,7%                                           |
| qui 29/10 | extra   | Anúncio das duas séries ("Agora tem hora marcada") | 19h10 · 158 views · ret. 18% (anuncia dias antigos)                                   |
| sex 30/10 | Explica | Seu carro custa R$ 2.100 por mês. Parado.          | 12h12 · 248 views · ret. 7% · compart. 0,5% (legenda sem o gancho na 1ª linha)        |
| seg 02/11 | Explica | Quem chegou aos 65 com mais? (`comecar-cedo`)      | 8h30 · 156 views · ret. 13% · 0 compart. (**foi com a legenda do "R$ 30 ou R$ 300"**) |
| ter 03/11 | News    | véspera do Copom                                   | não saiu                                                                              |

### Daqui até o lançamento

| Data      | Faltam | Série     | Reel                                                                                                      | Status |
| --------- | ------ | --------- | --------------------------------------------------------------------------------------------------------- | ------ |
| qua 04/11 | 59     | News      | Copom decide a Selic hoje: o que muda no seu bolso (poupança, CDB, financiamento) — 18h06 · 103 views em ~14 h · ret. 11% (5 s de 47,6) · compart. 3,5% (3) · 0 salvos | 📤     |
| sex 06/11 | 57     | Explica   | Frete grátis acima de R$ 99: a pegadinha do carrinho                                                      | 🆕     |
| seg 09/11 | 54     | Explica   | Garantia estendida: o seguro que paga a loja                                                              | 🆕     |
| qua 11/11 | 52     | News      | Inflação de outubro (IPCA sai 10/11): seu salário subiu e você não ficou mais rico                        | 🆕     |
| sex 13/11 | 50     | Explica   | Quanto o seu delivery custa em um ano                                                                     | 🆕     |
| seg 16/11 | 47     | Explica   | A regra 50-30-20 em 30 segundos (**revisão dos temas em 16/11**)                                          | 🆕     |
| qua 18/11 | 45     | News      | assunto da semana (reserva: ganha até R$ 5 mil? confira o holerite, isenção do IR)                        | 🆕     |
| sex 20/11 | 43     | Explica   | Reserva de emergência: qual é o seu número                                                                | 🆕     |
| seg 23/11 | 40     | Explica   | Seu banco é obrigado a te dar conta de graça (`alcance/tarifas-banco`)                                    | ✅     |
| qua 25/11 | 38     | News      | Black Friday chegando: o desconto de 25% que deixou a TV mais cara                                        | 🆕     |
| sex 27/11 | 36     | Explica   | 13º: o investimento que rende 100% ao ano é quitar dívida cara (dia da Black Friday)                      | 🆕     |
| seg 30/11 | 33     | Explica   | Pague-se primeiro: guardar no dia 1 ou no dia 30?                                                         | 🆕     |
| qua 02/12 | 31     | News      | assunto da semana                                                                                         | 🆕     |
| sex 04/12 | 29     | Explica   | Financiou um carro de R$ 80 mil? Você paga um carro e meio                                                | 🆕     |
| seg 07/12 | 26     | Explica   | R$ 30 por mês ou R$ 300 no anual? (`alcance/mensal-ou-anual`, longe do parcelado)                         | ✅     |
| qua 09/12 | 24     | News      | assunto da semana (Copom de dezembro, se for nessa semana)                                                | 🆕     |
| sex 11/12 | 22     | Explica   | As contas de janeiro que você esquece em dezembro (IPVA, IPTU, escola)                                    | 🆕     |
| seg 14/12 | 19     | Explica   | Natal sem fatura em janeiro: o orçamento dos presentes                                                    | 🆕     |
| qua 16/12 | 17     | News      | 2ª parcela do 13º (até 20/12): para onde vai cada real                                                    | 🆕     |
| sex 18/12 | 15     | Explica   | Natal em 10× vira janeiro até outubro (parcelas empilhadas)                                               | 🆕     |
| seg 21/12 | 12     | Explica   | Para onde foi o seu dinheiro em 2026?                                                                     | 🆕     |
| qua 23/12 | 10     | News      | assunto da semana, fechando com o teaser "Em 10 dias, você vai parar de adivinhar"                        | 🆕     |
| sáb 26/12 | 7      | Explica   | Meta de 2027 sem data é só desejo (sexta 25/12 é Natal: fica livre)                                       | 🆕     |
| dom 27/12 | 6      | Appliquei | Sonhos (`sonhos/`)                                                                                        | ✅     |
| seg 28/12 | 5      | Appliquei | Meus investimentos (`investimentos/`)                                                                     | ✅     |
| ter 29/12 | 4      | Appliquei | Patrimônio (`patrimonio/`)                                                                                | ✅     |
| qua 30/12 | 3      | Appliquei | Telegram (`telegram/`)                                                                                    | ✅     |
| qui 31/12 | 2      | Appliquei | Automações, 45 s (`resumo/appliquei-resumo-45s.mp4`), Réveillon                                           | ✅     |
| sex 01/01 | 1      | Appliquei | Teaser: "Você sabe quanto realmente tem?" (`lancamento-janeiro/`)                                         | ✅     |
| sáb 02/01 | 0      | Appliquei | **Lançamento:** "Tudo o que o Appliquei faz", 55 s (`resumo/appliquei-tudo-55s.mp4`), **fixar no perfil** | ✅     |

**Reserva (saíram da grade de 5 por semana):** R$ 100 de 2016 valem quanto
hoje? (regra dos 72 da inflação; bom para um News de IPCA) · Quanto tempo até
os primeiros R$ 100 mil · Alugar ou comprar? A regra do 0,5%.

**News:** o tema sai na véspera (terça), pela notícia econômica mais quente,
sempre com "e o seu bolso com isso?". As pautas acima são as datas que já se
sabem; confirmar na véspera. Os vídeos prontos são publicados na versão
`appliquei-<tema>-com-capa.mp4`.

As 9 pistas de sábado (que eram stories) viram a última frase de um Reel da
semana, quando couber:

| Sábado | Faltam | Pista                                                                  |
| ------ | ------ | ---------------------------------------------------------------------- |
| 31/10  | 63     | "Você sabe quanto tem agora? Em 2027, vai saber sem abrir planilha."   |
| 07/11  | 56     | "E se o seu dinheiro te avisasse antes de apertar?"                    |
| 14/11  | 49     | "Lançar um gasto vai levar 3 segundos. Pelo chat."                     |
| 21/11  | 42     | "Seus sonhos vão ter valor, prazo e quanto falta."                     |
| 28/11  | 35     | "Seus investimentos, todos numa tela, com o quanto rendem de verdade." |
| 05/12  | 28     | "Patrimônio é mais do que saldo. Você vai ver o seu inteiro."          |
| 12/12  | 21     | "Faltam 3 semanas. Já ativou o lembrete?"                              |
| 19/12  | 14     | "02/01/2027. Anota." (data + identidade visual)                        |
| 26/12  | 7      | "Amanhã começa. Uma função por dia até o lançamento."                  |

## Produção

- **Appliquei Explica:** 13 vídeos novos até 26/12, mais 2 já prontos. **News:**
  8 vídeos novos, um na véspera de cada quarta.
- **Cota de voz:** 1 pedido por vídeo, às vezes 2; cabe nos 10 por dia.
- **Revisão em 16/11** (3 semanas de dados): os temas que mais renderem
  ganham variações na fase 3.

## Anúncios (impulsionar, fora da série)

Peças com mais produto que educação. Servem para testar ganchos com R$ 10–20
por dia.

- ✅ "Abre o extrato e procura essas 3 coisas" (`alcance/tres-cobrancas`)
- ✅ "3 sinais de que o seu dinheiro vai apertar este mês" (`alcance/tres-sinais-aperto`)
- ✅ Automações, 45 s (`resumo/appliquei-resumo-45s.mp4`)
