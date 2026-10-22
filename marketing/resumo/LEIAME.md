# Resumo: "E se o seu controle financeiro trabalhasse por você?" (45 s)

Vídeo vitrine para fixar no perfil, com as automações do app em sequência.
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
