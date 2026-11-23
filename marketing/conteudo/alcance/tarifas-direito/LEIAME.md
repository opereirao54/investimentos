# "Conta sem tarifa é seu direito" (40,6 s) · Appliquei Explica

Reel de seg 23/11/2026 (faltam 40). Refeito no dia, a pedido do fundador, no
estilo combinado em 17–19/11; substitui `../tarifas-banco` (outubro, Caio e
Mateus). Roteiro e metáfora (opção A, tela do banco) aprovados em 23/11.
**Sem legenda** (fundador, 23/11).

- Diálogo Lia (Sulafat, um pedido) × Beto (Charon, uma fala por pedido).
  Na voz, "Appliquei" está escrito "Apliquêi" (`roteiro-lia.json`).
- Tela do banco: o extrato do Beto recebe "Tarifa pacote −40" mês a mês
  (JAN–MAR na 1ª fala, ABR–DEZ correndo no "480") e o total do ano sobe até
  R$ 480; a tela da Lia mostra tarifa R$ 0,00 e marca os serviços essenciais
  (Res. CMN 3.919/2010: cartão de débito, 4 saques e 2 extratos por mês, 2
  transferências entre contas do mesmo titular no mesmo banco; Pix grátis
  para pessoa física, Res. BCB 19/2020). Na regra de bolso as tarifas do
  extrato ficam marcadas em amarelo; no fim, comentários "SIM/NÃO".

Montar:

```bash
D=marketing/conteudo/alcance/tarifas-direito
# vozes: refaz os cortes das leituras salvas sem gastar cota
ROTEIRO=$D/roteiro-lia.json LEITURA=$D/narracao-sulafat-lia-leitura.wav python3 marketing/ferramentas/shorts/narrar-gemini.py /tmp/t/voz-lia Sulafat
#   (idem beto1/beto2 com Charon); partes.json na ordem L0 B1 L1 L2 B2 L3 L4, tempos de narracao.json
python3 marketing/ferramentas/shorts/trilha-alcance.py $D/narracao.json $D/trilha.wav --sem-moedas
node marketing/ferramentas/shorts/render.js /tmp/t/r $D/video.html
python3 marketing/ferramentas/shorts/mixar-narracao.py /tmp/t/voz-all $D/trilha.wav /tmp/t/r/video-sem-audio.mp4 $D/appliquei-tarifas-direito.mp4
# capa no 1º quadro (0,1 s) -> appliquei-tarifas-direito-com-capa.mp4; depois:
node marketing/ferramentas/shorts/contagem.js $D/appliquei-tarifas-direito-com-capa.mp4 40 marketing/conteudo/publicar/13-23-11-tarifas-direito.mp4
```
