# Resumo do app: dois vídeos

- **`appliquei-tudo-55s.mp4` — "Tudo o que o Appliquei faz" (55 s).** O
  resumo completo para **fixar no perfil**: o mês (com Telegram e categoria
  automática), avisos e Sistema inteligente, patrimônio (com FIPE),
  investimentos (rentabilidade, dividendos, futuro), carteira sugerida, sonhos
  e simulador, relatório com nota e Jornada, e a grade com as 16 funções.
- **`appliquei-resumo-45s.mp4` — "E se o seu controle financeiro trabalhasse
  por você?" (45 s).** Só as automações, com contador até 10. Serve como
  anúncio de diferencial, não como resumo.

## Tudo o que o Appliquei faz (55 s)

Arquivos: `tudo-55s.html`, `narracao-tudo.json`,
`narracao-tudo-charon-leitura.wav` e `trilha-tudo.wav`
(`marketing/ferramentas/shorts/trilha-tudo.py`).

Ficou com 55 s, e não com 45 s, porque a leitura natural do roteiro completo
dá 51 s. Caber em 45 s exigiria acelerar a voz 20%.

Cuidados:

- **Carteira sugerida:** aparece só a divisão por classe do perfil Moderado,
  com "cada ativo com os critérios à vista · sugestão informativa · você
  decide". A nota de ativo ("Ação A · 74/100") ficou de fora. A análise ativo
  a ativo é o que depende da pendência CVM, então ela fica só no vídeo próprio
  da carteira, que é só orgânico. Assim o resumo pode ser fixado e
  impulsionado.
- **Projeção e simulador:** marcados como "simulação".
- **Sistema inteligente:** apresentado como "estatística sobre o seu
  histórico, não IA".
- **Relatório:** sem o critério do Applicash, que está em reformulação.
- **Aviso final:** dados de demonstração; carteira, projeções e simulações
  são material informativo, não recomendação de investimento; investimentos
  envolvem risco; Telegram é marca de seu titular.
- **Números:** os mesmos dos vídeos de cada função. O mês fecha: R$ 6.200 de
  receitas − R$ 3.580 de despesas − R$ 1.240 de fatura = R$ 1.380 de sobra.
  As despesas dão 58% da entrada, o que bate com o critério "≤ 60%" do
  termômetro.

Legenda:

> Tudo o que você precisa para cuidar do seu dinheiro, num app só. 👇
>
> 📅 O mês: receitas, despesas e cartões, lançados até pelo Telegram
> 🔔 Avisos de contas, faturas e do dia em que o saldo vai apertar
> 🔍 Cobrança repetida e gasto fora do normal, sem você procurar
> 🏛️ Patrimônio somado, com o carro pela tabela FIPE
> 📈 Investimentos, dividendos e quanto isso vira no futuro
> 🧮 Carteira sugerida com o cálculo à vista
> ✈️ Sonhos com prazo e parcela, e simulador para viver de renda
> 📊 Relatório com nota do mês e uma jornada para aprender a investir
>
> Appliquei chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Dados de demonstração. Carteira sugerida, projeções e simulações são
> material informativo, não recomendação de investimento. Investimentos
> envolvem risco. Telegram é marca de seu titular, sem vínculo com o Appliquei.
>
> #financaspessoais #controlefinanceiro #investimentos #organizacaofinanceira #educacaofinanceira

Refazer:

```bash
python3 marketing/ferramentas/shorts/trilha-tudo.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/resumo/trilha-tudo.wav
node marketing/ferramentas/shorts/render.js /tmp/tudo marketing/resumo/tudo-55s.html
ROTEIRO=marketing/resumo/narracao-tudo.json LEITURA=marketing/resumo/narracao-tudo-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/resumo/trilha-tudo.wav \
  /tmp/tudo/video-sem-audio.mp4 marketing/resumo/appliquei-tudo-55s.mp4
```

---

# Automações: "E se o seu controle financeiro trabalhasse por você?" (45 s)

Anúncio de diferencial: as automações do app em sequência (o resumo para
fixar no perfil é o de 55 s, acima).
Um contador no canto sobe a cada uma até chegar a 10, e o vídeo fecha com a
assinatura do teaser ("Seu dinheiro precisa de direção."). A narração usa a
voz padrão da marca (Charon, Gemini).

- `appliquei-resumo-45s.mp4`: versão final narrada (-15 LUFS).
- `appliquei-resumo-45s-sem-audio.mp4`: só a imagem.
- `resumo-45s.html`: as cenas. A lista de onde cada automação mora no
  código está no comentário do topo do arquivo.
- `narracao.json`: a fala e os tempos.
- `narracao-charon-leitura.wav`: a leitura aprovada.
- `trilha-resumo.wav`: a trilha.

## As 10 automações (todas existem no app hoje)

1. Telegram: "mercado 52,90" vira despesa lançada, com categoria.
2. App: sugere a categoria pelo seu histórico.
3. Aviso de conta que vence amanhã.
4. Aviso de fatura que vai fechar.
5. Aviso do dia em que o saldo vai ficar no vermelho, antes de acontecer.
6. Cobrança repetida.
7. Assinatura que subiu de preço.
8. Gasto fora do normal.
9. Dividendos lançados como entrada, calculados pelos ativos que você
   registrou.
10. Parcela do sonho lançada no mês.

## Cuidados

- O vídeo mostra a pessoa lançando, pelo Telegram e pelo formulário, para
  não prometer que o app faz tudo sozinho. Os dividendos trazem a nota
  "calculados pelos ativos que você registrou": não há integração com
  corretora.
- O Sistema inteligente aparece como "estatística sobre o seu histórico, não
  IA", como pede `produto.md`.
- As telas usam dados de demonstração e os números são os mesmos dos outros
  vídeos da série. O aviso final informa que o Telegram é marca de seu
  titular, sem vínculo com o Appliquei.

## Legenda

> Um app de finanças que trabalha por você. 👇
>
> ✅ Você manda "mercado 52,90" no Telegram e ele lança com a categoria
> 📅 Avisa a conta que vence amanhã e a fatura que vai fechar
> 🔻 Avisa o dia em que o saldo vai ficar no vermelho, antes de acontecer
> 🔍 Percebe cobrança repetida, assinatura que subiu e gasto fora do normal
> 💰 Lança seus dividendos e a parcela do seu sonho no mês
>
> Patrimônio, investimentos, sonhos e o mês, numa tela só.
>
> Appliquei chega em janeiro de 2027. Siga para saber primeiro. 🔔
>
> Telas com dados de demonstração. Telegram é marca de seu titular, sem
> vínculo com o Appliquei.
>
> #financaspessoais #controlefinanceiro #organizacaofinanceira #educacaofinanceira #investimentos

## Refazer

```bash
python3 marketing/ferramentas/shorts/trilha-resumo.py /tmp/trilha.wav
ffmpeg -i /tmp/trilha.wav -af "lowpass=f=13000,volume=3dB,alimiter=limit=0.70:level=disabled:attack=1:release=60" marketing/resumo/trilha-resumo.wav
node marketing/ferramentas/shorts/render.js /tmp/resumo marketing/resumo/resumo-45s.html
ROTEIRO=marketing/resumo/narracao.json LEITURA=marketing/resumo/narracao-charon-leitura.wav \
  python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/voz
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/voz marketing/resumo/trilha-resumo.wav \
  /tmp/resumo/video-sem-audio.mp4 marketing/resumo/appliquei-resumo-45s.mp4
```
