# "Ganha até R$ 5 mil? Seu 13º vem até R$ 337 mais gordo" (38 s) · Appliquei News

**Versão final (18/11, à tarde): dinâmica.** O fundador pediu o estilo do
Reel da @cafecomseudinheiro: as coisas surgem, se mexem e se transformam numa
cena contínua, em vez de cartões trocando. As notas saem do envelope do 13º
para a caixa vermelha do IR e voltam no "sem imposto"; a escada é feita de
pilhas de dinheiro crescendo, com o valor contando; o Beto entra e sai pela
lateral em cada fala; o carrinho da Black Friday puxa notas das pilhas e elas
voltam no "Calma"; o calendário vira de 30/11 para 18/12; o holerite sobe;
fecho com "Você já sabia dessa?" e os botões SIM e NÃO pulando. Câmera com
deriva lenta e um "soco" de zoom a cada fala. Tudo em `video.html` (função
`poe` posiciona cada objeto pelo centro; `vida` faz a entrada e a saída).

Reel de qua 18/11/2026 (faltam 45). Tema escolhido pelo fundador em 17/11 (era
a reserva do calendário): a nova regra do IR zera o imposto do 13º para quem
ganha até R$ 5 mil. Apartidário ("a nova regra do Imposto de Renda", sem
governo nem partido), sem recomendação.

**Refeito em 18/11 (fundador: "quero melhorar o conteúdo do vídeo")** com o
que funciona na @cafecomseudinheiro (684 mil seguidores, analisada pela API
em 18/11): **conta em degraus por salário** (R$ 3.000 → +24, 4.000 → +151,
4.500 → +240, 5.000 → +337; R$ 2.500 já era isento), a maior escada no fim, e
**pergunta no fim**: primeiro "Comenta o seu salário", trocada pelo fundador
por "Você já sabia dessa? Comenta sim ou não" (salário é dado pessoal).

Versão anterior (17/11): **gancho falando com quem assiste** ("Se você ganha até cinco mil, olha o
seu décimo terceiro…") e a etiqueta "salário de R$ 4.500 · até R$ 240 a
mais" (os R$ 240 valem só para esse salário; quem ganha R$ 2.500 já não
pagava IR no 13º), ajustes aprovados em 17/11.

**Pacote de melhorias, todas juntas (fundador, 17/11: "se não funcionar,
retrocedemos"):**

1. **Diálogo** Lia (Sulafat) × Beto (Charon), sem narrador. Um take por voz
   (`narracao-sulafat-lia-leitura.wav`, `narracao-charon-beto-leitura.wav`);
   `falantes.json` diz quem fala cada linha do `narracao.json`.
2. **Cortes a cada ~2–3 s** (12 cenas em 35 s, com "soco" de zoom no corte),
   e um selo no alto com quem está falando.
3. **Tela de celular** com o holerite (a linha do IR riscada vira R$ 0,00).
4. ~~Legenda sincronizada~~: tirada pelo fundador em 17/11 ("tira a legenda
   toda"), por excesso de texto na tela.

Imagem real no 1º segundo ficou de fora (fundador escolheu a opção 3): o
banco de vídeos grátis não abre desta rede e a geração de imagem do Gemini
não tem cota grátis.

- `../../publicar/10-18-11-decimo-terceiro-ir.mp4`: **o arquivo para postar**
  (capa no 1º quadro, selo "Faltam 45 dias") e `-capa.png`.
- `appliquei-decimo-terceiro-ir-com-capa.mp4` (sem selo) e
  `appliquei-decimo-terceiro-ir.mp4` (sem capa nem selo).
- `video.html`, `narracao.json`, `falantes.json`, `trilha.wav`
  (`trilha-alcance.py … --sem-moedas`), `capa.json`/`capa.png`.

Para refazer as vozes sem gastar cota: rodar `narrar-gemini.py` com
`LEITURA=` uma vez por voz (roteiro só com as linhas daquela pessoa, voz
Sulafat ou Charon no 2º argumento), juntar os dois `partes.json` em ordem de
tempo numa pasta só e passar essa pasta ao `mixar-narracao.py`.

## Os números

| Dado                   | Valor                                          | Fonte                              |
| ---------------------- | ---------------------------------------------- | ---------------------------------- |
| IR do 13º até R$ 5 mil | zero; redução parcial até R$ 7.350             | Lei 15.270/2025 (FerramentaBR, JB) |
| Salário de exemplo     | R$ 4.500                                       | exemplo                            |
| INSS do 13º (2026)     | R$ 431,51                                      | Valorfinal (exemplo de R$ 4.500)   |
| IR pela tabela antiga  | 22,5% × 4.068,49 − 675,49 = R$ 239,92          | conta (tabela de 2025)             |
| Parcelas               | 1ª até 30/11 (sem IR); 2ª até 18/12 (com o IR) | Gazeta SP, O Povo                  |
| Black Friday           | 27/11                                          | Mix Vale                           |

**O que medir:** taxa de pulados e curva nos 3 s, tempo médio e retenção
contra a gasolina (11,3 s, 32%) e a Black Friday de 16/11 (3,3 s);
compartilhamentos (pedido "pra quem ganha até cinco mil").
