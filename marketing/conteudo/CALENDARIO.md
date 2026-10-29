# Calendário até o lançamento: duas séries de Reels, de 26/10/2026 a 02/01/2027

**Objetivo:** fazer a pessoa seguir a página (educação e planejamento
financeiro) e criar expectativa pelo lançamento de **02/01/2027**, sem mostrar
o app antes da última semana. Cada vídeo resolve uma dor real e termina com
uma pista do que vem.

PDF simples para compartilhar: `plano-instagram.pdf` (fonte
`plano-instagram.html`; gerar com `node marketing/conteudo/gerar-pdf.js`).

## Regras

- **Duas séries, só Reels (fundador, 29/10):** **Conta de Padaria** (seg, qua
  e sex; os temas da tabela abaixo) e **Appliquei News** (ter e qui; a
  notícia econômica do momento traduzida para o bolso, tema escolhido na
  véspera). 5 Reels por semana a partir de 02/11 e todo dia de 27/12 a 02/01.
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

## Conta de Padaria (seg, qua e sex) e os vídeos de produto

✅ pronto · 🆕 a fazer

| #   | Data      | Faltam | Reel                                                                                                      | Status | Publicado |
| --- | --------- | ------ | --------------------------------------------------------------------------------------------------------- | ------ | --------- |
| 1   | seg 26/10 | 68     | Mesma compra: 11 ou 38 dias pra pagar? (`alcance/melhor-dia-compra`)                                      | ✅     |           |
| 2   | qua 28/10 | 66     | Parcelado sem juros ou à vista com desconto? (`alcance/avista-ou-parcelado`)                              | ✅     |           |
| 3   | qui 29/10 | 65     | O dólar disparou. E o seu pãozinho? (`alcance/dolar-paozinho`; assunto da semana, antecipado)             | ✅     |           |
| 4   | seg 02/11 | 61     | Seu carro custa R$ 2.100 por mês. Parado. (`alcance/carro-ou-aplicativo`)                                 | ✅     |           |
| 5   | qua 04/11 | 59     | Ganha até R$ 5 mil? Confira seu holerite (isenção do IR desde jan/2026)                                   | 🆕     |           |
| 6   | sex 06/11 | 57     | Garantia estendida: o seguro que paga a loja                                                              | 🆕     |           |
| 7   | seg 09/11 | 54     | Quanto o seu delivery custa em um ano                                                                     | 🆕     |           |
| 8   | qua 11/11 | 52     | Pague-se primeiro: guardar no dia 1 ou no dia 30?                                                         | 🆕     |           |
| 9   | sex 13/11 | 50     | Seu salário subiu e você não ficou mais rico (aumento × inflação)                                         | 🆕     |           |
| 10  | seg 16/11 | 47     | A regra 50-30-20 em 30 segundos                                                                           | 🆕     |           |
| 11  | qua 18/11 | 45     | Financiou um carro de R$ 80 mil? Você paga um carro e meio                                                | 🆕     |           |
| 12  | sex 20/11 | 43     | Reserva de emergência: qual é o seu número                                                                | 🆕     |           |
| 13  | seg 23/11 | 40     | Seu banco é obrigado a te dar conta de graça (`alcance/tarifas-banco`)                                    | ✅     |           |
| 14  | qua 25/11 | 38     | Black Friday: o desconto de 25% que deixou a TV mais cara                                                 | 🆕     |           |
| 15  | sex 27/11 | 36     | 13º: o investimento que rende 100% ao ano é quitar dívida cara (dia da Black Friday)                      | 🆕     |           |
| 16  | seg 30/11 | 33     | R$ 100 de 2016 valem quanto hoje? (a regra dos 72 da inflação)                                            | 🆕     |           |
| 17  | qua 02/12 | 31     | Investiu 3× menos e chegou aos 65 com mais (`alcance/comecar-cedo`)                                       | ✅     |           |
| 18  | sex 04/12 | 29     | Quanto tempo até os primeiros R$ 100 mil                                                                  | 🆕     |           |
| 19  | seg 07/12 | 26     | Alugar ou comprar? A regra do 0,5%                                                                        | 🆕     |           |
| 20  | qua 09/12 | 24     | R$ 30 por mês ou R$ 300 no ano? (`alcance/mensal-ou-anual`)                                               | ✅     |           |
| 21  | sex 11/12 | 22     | As contas de janeiro que você esquece em dezembro (IPVA, IPTU, escola)                                    | 🆕     |           |
| 22  | seg 14/12 | 19     | Natal sem fatura em janeiro: o orçamento dos presentes                                                    | 🆕     |           |
| 23  | qua 16/12 | 17     | Natal em 10× vira janeiro até outubro (parcelas empilhadas)                                               | 🆕     |           |
| 24  | sex 18/12 | 15     | 2ª parcela do 13º (20/12): para onde vai cada real                                                        | 🆕     |           |
| 25  | seg 21/12 | 12     | Para onde foi o seu dinheiro em 2026?                                                                     | 🆕     |           |
| 26  | qua 23/12 | 10     | Teaser de mistério: "Em 10 dias, você vai parar de adivinhar" (sem tela do app)                           | 🆕     |           |
| 27  | sáb 26/12 | 7      | Meta de 2027 sem data é só desejo (sábado: o 25/12 fica livre)                                            | 🆕     |           |
| 28  | dom 27/12 | 6      | Sonhos (`sonhos/`)                                                                                        | ✅     |           |
| 29  | seg 28/12 | 5      | Meus investimentos (`investimentos/`)                                                                     | ✅     |           |
| 30  | ter 29/12 | 4      | Patrimônio (`patrimonio/`)                                                                                | ✅     |           |
| 31  | qua 30/12 | 3      | Telegram (`telegram/`)                                                                                    | ✅     |           |
| 32  | qui 31/12 | 2      | Automações, 45 s (`resumo/appliquei-resumo-45s.mp4`), Réveillon                                           | ✅     |           |
| 33  | sex 01/01 | 1      | Teaser: "Você sabe quanto realmente tem?" (`lancamento-janeiro/`)                                         | ✅     |           |
| 34  | sáb 02/01 | 0      | **Lançamento:** "Tudo o que o Appliquei faz", 55 s (`resumo/appliquei-tudo-55s.mp4`), **fixar no perfil** | ✅     |           |

O #3 saiu na quinta 29/10 (o assunto do dólar estava quente) e a sexta 30/10 ficou sem Reel. "Frete grátis acima de R$ 99" (antes o #3) ficou de reserva: entra se algum tema cair na revisão de 16/11.

Os vídeos prontos de alcance são publicados na versão `appliquei-<tema>-com-capa.mp4`.

## Appliquei News (ter e qui)

O tema sai na véspera, pela notícia econômica mais quente, sempre com "e o
seu bolso com isso?". Datas da agenda que já se sabe (confirmar na véspera):

| #   | Data      | Faltam | Pauta provável                                                 | Publicado |
| --- | --------- | ------ | -------------------------------------------------------------- | --------- |
| 1   | qui 29/10 | 65     | O dólar disparou. E o seu pãozinho? (`alcance/dolar-paozinho`) |           |
| 2   | ter 03/11 | 60     | véspera do Copom: o que a Selic muda no seu bolso              |           |
| 3   | qui 05/11 | 58     | a decisão do Copom (04/11): poupança, CDB, financiamento       |           |
| 4   | ter 10/11 | 53     | inflação de outubro (IPCA, se sair nessa semana)               |           |
| 5   | qui 12/11 | 51     | assunto da semana                                              |           |
| 6   | ter 17/11 | 46     | assunto da semana                                              |           |
| 7   | qui 19/11 | 44     | assunto da semana                                              |           |
| 8   | ter 24/11 | 39     | Black Friday chegando: o que está mais caro e mais barato      |           |
| 9   | qui 26/11 | 37     | véspera da Black Friday / 1ª parcela do 13º (até 30/11)        |           |
| 10  | ter 01/12 | 32     | assunto da semana                                              |           |
| 11  | qui 03/12 | 30     | assunto da semana                                              |           |
| 12  | ter 08/12 | 25     | assunto da semana (Copom de dezembro, se for nessa semana)     |           |
| 13  | qui 10/12 | 23     | assunto da semana                                              |           |
| 14  | ter 15/12 | 18     | assunto da semana                                              |           |
| 15  | qui 17/12 | 16     | 2ª parcela do 13º (até 20/12)                                  |           |
| 16  | ter 22/12 | 11     | assunto da semana                                              |           |
| 17  | qui 24/12 | 9      | véspera de Natal: assunto da semana                            |           |

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

- **Conta de Padaria:** 22 vídeos novos em 9 semanas. **News:** 16 vídeos
  novos, um na véspera de cada terça e quinta.
- **Cota de voz:** 1 pedido por vídeo, às vezes 2; cabe nos 10 por dia.
- **Revisão em 16/11** (3 semanas de dados): os temas que mais renderem
  ganham variações na fase 3.

## Anúncios (impulsionar, fora da série)

Peças com mais produto que educação. Servem para testar ganchos com R$ 10–20
por dia.

- ✅ "Abre o extrato e procura essas 3 coisas" (`alcance/tres-cobrancas`)
- ✅ "3 sinais de que o seu dinheiro vai apertar este mês" (`alcance/tres-sinais-aperto`)
- ✅ Automações, 45 s (`resumo/appliquei-resumo-45s.mp4`)
