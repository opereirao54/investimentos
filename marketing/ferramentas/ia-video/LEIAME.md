# Imagens e clipes de IA sem ficar parado

Pedido do fundador (22/11/2026): quando uma cota grátis acabar, a produção
continua no próximo fornecedor, mantendo a qualidade sempre que der.

```bash
pip install httpx numpy          # uma vez
python3 marketing/ferramentas/ia-video/ia.py imagem "<prompt>" saida.png --largura 720 --altura 1280
python3 marketing/ferramentas/ia-video/ia.py clipe inicio.png "<prompt>" saida.mp4 --segundos 5
python3 marketing/ferramentas/ia-video/ia.py preparar-local   # só se for usar o modo local
```

A ferramenta tenta em ordem e diz quem atendeu (`[hf] ok`, `[modal] pulou: …`):

| Ordem | Imagem                                  | Clipe                                    | Qualidade           | Custo                               |
| ----- | --------------------------------------- | ---------------------------------------- | ------------------- | ----------------------------------- |
| 0     | `cloudflare`: FLUX.2 klein 4B, 720×1280 | —                                        | boa (testada 22/11) | grátis, ~60 imagens/dia, sem cartão |
| 1     | `hf`: FLUX.1 schnell (Space)            | `hf`: Wan 2.2 14B Lightning (Space)      | a aprovada          | grátis, cota diária (ZeroGPU)       |
| 2     | `modal`: Z-Image Turbo¹                 | `modal`: Wan 2.2 5B, 720p¹               | a mesma             | créditos grátis do Modal            |
| 3     | `gemini`: modelo de imagem              | —                                        | boa                 | grátis, cota pequena                |
| 4     | `local`: 1 quadro do Wan 2.2 5B Turbo   | `local`: Wan 2.2 5B Turbo no processador | **rascunho**        | grátis, sem limite                  |

- ¹ Plano grátis do Modal (conta sem cartão, ~US$ 5/mês, só placas L4).
  Com cartão cadastrado (US$ 30/mês grátis e placas grandes), mude
  `PLANO = "cartao"` no `modal_app.py`: volta a receita do Wan 2.2 14B dos
  clipes aprovados (H100) e o FLUX.1 schnell (L40S).
- **Imagens vão primeiro para a Cloudflare:** no Hugging Face cada imagem do
  FLUX reserva 70 s dos 300 s grátis do dia (doc oficial do ZeroGPU), e foi
  isso que esgotou a cota em 22/11. Sem imagens, a cota rende 5 a 6 clipes
  por dia (~50 s cada, com 4 passos). Conta Cloudflare grátis; o token fica
  como segredo de rede de `api.cloudflare.com` e o Account ID em
  `IA_CF_ACCOUNT`.
- `--so hf,modal` limita ou reordena. O `local` serve para não parar, nunca
  para postar sem o fundador ver: clipe de ~0,7 s em ~2 min, 384×672, com
  manchas perto de braços e mãos; imagem em ~100 s, até 704×1280.
- **Banco de reações:** clipes de personagem que se repetem (pânico,
  comemoração, joinha) ficam guardados e são reaproveitados, e os de um Reel
  são gerados com 2 dias de antecedência. Assim a cota do dia vai só para a
  cena nova.

## O estúdio no Modal

`modal_app.py` (app `estudio-ia`) é publicado pelo GitHub Actions
(`.github/workflows/modal-ia-video.yml`) a cada mudança nesta pasta: a rede
das sessões na nuvem não passa o gRPC do cliente do Modal, então as sessões só
chamam o endereço HTTPS. Atende também o `Projeto-redessociais`.

- Segredos do repositório (GitHub > Settings > Secrets > Actions):
  `MODAL_TOKEN_ID` e `MODAL_TOKEN_SECRET` (modal.com > Settings > API Tokens)
  e `APPLIQUEI_IA_KEY` (senha que protege o endereço).
- No ambiente da nuvem: `IA_MODAL_URL` com o endereço que o deploy imprime;
  a senha fica como segredo de rede do endereço (a rede a põe no cabeçalho
  `Authorization`), ou em `IA_MODAL_KEY` fora da nuvem.
- A 1ª chamada baixa os modelos para o volume `estudio-ia-cache` (10 a 15 min);
  depois, ~1 a 2 min por clipe. O container fica ligado 5 min depois do último
  pedido.

## Modo local

`ia.py preparar-local` compila o [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)
(MIT) e baixa para `~/.cache/ia-local` (ou `IA_LOCAL_DIR`) cerca de 9 GB: Wan 2.2
TI2V 5B Turbo em GGUF Q4 (Apache 2.0), o codificador umt5 em GGUF, o VAE do
Wan 2.2 e o decodificador leve TAEHV (MIT; convertido para safetensors sem
precisar do torch). Testado numa sessão com 4 núcleos e 15 GB: o VAE completo
estoura a memória, por isso a decodificação usa o leve.

## Personagens sempre iguais (22/11)

`ia.py editar <referência.png> "<prompt>" saída.jpg` cria uma cena nova a partir
da imagem de referência (Cloudflare FLUX.2 klein, campo `input_image_0`; aceita
várias separadas por vírgula). A referência do Beto e da Lia em 3D é
`marketing/personagens/beto-lia-3d.png`: toda cena parte dela, com "Only the
man in the red t-shirt…" ou "Only the woman with the brown ponytail…" e "Keep
exactly the same character, same art style". Gerar do zero muda o rosto.
O filtro da Cloudflare às vezes barra um resultado inocente ("flagged"): o
`ia.py` tenta outras 2 sementes; se persistir, mude a frase ou parta de uma
cena já aprovada.

## Gráficos por cima dos clipes (22/11)

`CAMADA=1 node marketing/ferramentas/shorts/render.js <pasta> <camada.html>`
salva os quadros com fundo transparente (gráficos e legenda), e o ffmpeg os
põe por cima dos clipes de IA. Exemplo completo em
`marketing/conteudo/alcance/black-friday-3min/`.

## Ampliar com IA (23/11)

Os clipes do Wan saem em 480×832 e ficavam macios quando esticados para
1080×1920. `ia.py ampliar clipe.mp4 clipe-hd.mp4` passa cada quadro pelo
Real-ESRGAN anime 6B (x4, BSD-3, próprio para desenho e 3D) e reduz para
1104 px de largura: contornos, olhos e roupa saem nítidos, sem as manchas da
compressão (comparado no rosto da Lia em 23/11). Funciona também em imagem.
No processador desta nuvem leva ~30 s por quadro (um clipe de 5 s = 81
quadros, ~40 min); se for interrompido, retoma de onde parou. Os pesos (18 MB)
são baixados do Hugging Face na 1ª vez. Precisa de `pip install torch pillow numpy`.
Fluxo: gerar clipes → ampliar → montar.
