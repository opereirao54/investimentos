"""Estudio de IA no Modal: clipes e imagens, plano B da cota do Hugging Face.

Atende os projetos de conteudo do fundador (Appliquei e Projeto-redessociais),
chamado pelo ia.py de cada um. Dois planos, escolhidos em PLANO:

  "gratis" (conta sem cartao, ~US$ 5/mes de credito; so placas pequenas):
      clipe  Wan 2.2 TI2V 5B (Apache 2.0), 704x1280, 24 fps, numa L4
      imagem Z-Image Turbo (Apache 2.0), 9 passos, numa L4
  "cartao" (meio de pagamento cadastrado: US$ 30/mes e placas grandes):
      clipe  Wan 2.2 I2V A14B + LoRA Lightning em 4 passos, 16 fps, numa H100
             (a receita do Space zerogpu-aoti/wan2-2-fp8da-aoti-faster, que
             fez os clipes aprovados pelo fundador em 22/11)
      imagem FLUX.1 schnell (Apache 2.0), 4 passos, numa L40S

Quem publica e o GitHub Actions (.github/workflows/modal-ia-video.yml): a rede
das sessoes na nuvem nao deixa passar o gRPC do cliente do Modal, entao daqui
so se chama o endereco HTTPS abaixo, com a chave em "Authorization: Bearer".

  POST /gerar  clipe:  {"tipo": "clipe", "imagem": "<png/jpg em base64>",
                        "prompt": "...", "segundos": 5, "passos": 0,
                        "semente": 42, "negativo": "..."}   (passos 0 = padrao)
               imagem: {"tipo": "imagem", "prompt": "...", "largura": 720,
                        "altura": 1280, "semente": 7}
               -> {"id": "<chamada>"}
  GET  /resultado/<id>  -> 202 enquanto gera; 200 com o mp4 ou o png quando
                           pronto; 500 com o erro, se falhar
  GET  /plano           -> qual plano esta publicado

O container fica ligado 5 min depois do ultimo pedido (scaledown_window) para
emendar pedidos sem recarregar o modelo.
"""

import base64
import hmac
import io
import os

import modal

PLANO = "gratis"  # "cartao" quando houver meio de pagamento no Modal

NEGATIVO = (
    "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, "
    "最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, "
    "画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, "
    "杂乱的背景, 三条腿, 背景人很多, 倒着走"
)

imagem_gpu = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.11.0",
        "torchao==0.17.0",
        "diffusers",
        "transformers",
        "accelerate",
        "safetensors",
        "sentencepiece",
        "peft",
        "ftfy",
        "imageio",
        "imageio-ffmpeg",
        "pillow",
        "numpy",
        "huggingface_hub",
    )
    .env({"HF_HOME": "/cache/hf"})
)
imagem_web = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")
cache = modal.Volume.from_name("estudio-ia-cache", create_if_missing=True)
app = modal.App("estudio-ia")


def ajustar(img, maior, menor, multiplo):
    """Recorta e redimensiona mantendo a proporcao: lado maior `maior`,
    menor `menor`, multiplos de `multiplo` (mesma regra do Space)."""
    from PIL import Image

    w, h = img.size
    if w == h:
        lado = (menor + maior) // 2 // multiplo * multiplo
        return img.resize((lado, lado), Image.LANCZOS)
    ar, maxar, minar = w / h, maior / menor, menor / maior
    if ar > maxar:
        tw, th = maior, menor
        cw = int(round(h * maxar))
        img = img.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    elif ar < minar:
        tw, th = menor, maior
        ch = int(round(w / minar))
        img = img.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
    elif w > h:
        tw, th = maior, int(round(maior / ar))
    else:
        th, tw = maior, int(round(maior * ar))
    tw = max(menor, min(maior, round(tw / multiplo) * multiplo))
    th = max(menor, min(maior, round(th / multiplo) * multiplo))
    return img.resize((tw, th), Image.LANCZOS)


def mp4(quadros, fps):
    import tempfile

    from diffusers.utils.export_utils import export_to_video

    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        export_to_video(quadros, f.name, fps=fps)
        return open(f.name, "rb").read()


def png(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


if PLANO == "cartao":

    @app.cls(image=imagem_gpu, gpu="H100", memory=65536, volumes={"/cache": cache}, timeout=1800, scaledown_window=300)
    class Clipe:
        @modal.enter()
        def carregar(self):
            import torch
            from diffusers.models.transformers.transformer_wan import WanTransformer3DModel
            from diffusers.pipelines.wan.pipeline_wan_i2v import WanImageToVideoPipeline
            from huggingface_hub import snapshot_download
            from torchao.quantization import Int8WeightOnlyConfig, quantize_

            bf16 = "cbensimon/Wan2.2-I2V-A14B-bf16-Diffusers"
            t1 = WanTransformer3DModel.from_pretrained(bf16, subfolder="transformer", torch_dtype=torch.bfloat16, device_map="cuda")
            t2 = WanTransformer3DModel.from_pretrained(bf16, subfolder="transformer_2", torch_dtype=torch.bfloat16, device_map="cuda")
            # os transformers vem do repositorio bf16 acima; do oficial, so o resto
            base = snapshot_download("Wan-AI/Wan2.2-I2V-A14B-Diffusers", ignore_patterns=["transformer/*", "transformer_2/*"])
            pipe = WanImageToVideoPipeline.from_pretrained(base, transformer=t1, transformer_2=t2, torch_dtype=torch.bfloat16).to("cuda")
            lora = ("Kijai/WanVideo_comfy", "Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors")
            pipe.load_lora_weights(lora[0], weight_name=lora[1], adapter_name="lightx2v")
            pipe.load_lora_weights(lora[0], weight_name=lora[1], adapter_name="lightx2v_2", load_into_transformer_2=True)
            pipe.set_adapters(["lightx2v", "lightx2v_2"], adapter_weights=[1.0, 1.0])
            pipe.fuse_lora(adapter_names=["lightx2v"], lora_scale=3.0, components=["transformer"])
            pipe.fuse_lora(adapter_names=["lightx2v_2"], lora_scale=1.0, components=["transformer_2"])
            pipe.unload_lora_weights()
            quantize_(pipe.text_encoder, Int8WeightOnlyConfig())
            cache.commit()
            self.pipe = pipe

        @modal.method()
        def gerar(self, imagem: bytes, prompt: str, negativo: str, segundos: float, passos: int, semente: int) -> bytes:
            import torch
            from PIL import Image

            img = ajustar(Image.open(io.BytesIO(imagem)).convert("RGB"), 832, 480, 16)
            fps = 16
            quadros = 1 + int(min(max(round(segundos * fps), 8), 80))
            saida = self.pipe(
                image=img, prompt=prompt, negative_prompt=negativo or NEGATIVO,
                height=img.height, width=img.width, num_frames=quadros,
                guidance_scale=1.0, guidance_scale_2=1.0, num_inference_steps=int(passos) or 4,
                generator=torch.Generator(device="cuda").manual_seed(int(semente)),
            ).frames[0]
            return mp4(saida, fps)

    @app.cls(image=imagem_gpu, gpu="L40S", memory=49152, volumes={"/cache": cache}, timeout=900, scaledown_window=300)
    class Imagem:
        @modal.enter()
        def carregar(self):
            import torch
            from diffusers import FluxPipeline

            self.pipe = FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-schnell", torch_dtype=torch.bfloat16).to("cuda")
            cache.commit()

        @modal.method()
        def gerar(self, prompt: str, largura: int, altura: int, semente: int) -> bytes:
            import torch

            img = self.pipe(
                prompt=prompt,
                width=max(256, min(2048, int(largura) // 16 * 16)),
                height=max(256, min(2048, int(altura) // 16 * 16)),
                num_inference_steps=4, guidance_scale=0.0, max_sequence_length=256,
                generator=torch.Generator(device="cuda").manual_seed(int(semente)),
            ).images[0]
            return png(img)

else:

    @app.cls(image=imagem_gpu, gpu="L4", memory=32768, volumes={"/cache": cache}, timeout=1800, scaledown_window=300)
    class Clipe:
        @modal.enter()
        def carregar(self):
            import torch
            from diffusers import WanImageToVideoPipeline

            pipe = WanImageToVideoPipeline.from_pretrained("Wan-AI/Wan2.2-TI2V-5B-Diffusers", torch_dtype=torch.bfloat16)
            pipe.enable_model_cpu_offload()  # 24 GB: so o componente em uso fica na placa
            try:
                pipe.vae.enable_tiling()
            except Exception:
                pass
            cache.commit()
            self.pipe = pipe

        @modal.method()
        def gerar(self, imagem: bytes, prompt: str, negativo: str, segundos: float, passos: int, semente: int) -> bytes:
            import torch
            from PIL import Image

            img = ajustar(Image.open(io.BytesIO(imagem)).convert("RGB"), 1280, 704, 32)
            fps = 24
            quadros = int(min(max(round(segundos * fps), 17), 121)) // 4 * 4 + 1  # 4k+1
            saida = self.pipe(
                image=img, prompt=prompt, negative_prompt=negativo or NEGATIVO,
                height=img.height, width=img.width, num_frames=quadros,
                guidance_scale=5.0, num_inference_steps=int(passos) or 30,
                generator=torch.Generator(device="cpu").manual_seed(int(semente)),
            ).frames[0]
            return mp4(saida, fps)

    @app.cls(image=imagem_gpu, gpu="L4", memory=32768, volumes={"/cache": cache}, timeout=900, scaledown_window=300)
    class Imagem:
        @modal.enter()
        def carregar(self):
            import torch
            from diffusers import ZImagePipeline

            self.pipe = ZImagePipeline.from_pretrained("Tongyi-MAI/Z-Image-Turbo", torch_dtype=torch.bfloat16)
            self.pipe.enable_model_cpu_offload()
            cache.commit()

        @modal.method()
        def gerar(self, prompt: str, largura: int, altura: int, semente: int) -> bytes:
            import torch

            img = self.pipe(
                prompt=prompt,
                width=max(256, min(1536, int(largura) // 16 * 16)),
                height=max(256, min(1536, int(altura) // 16 * 16)),
                num_inference_steps=9, guidance_scale=0.0,
                generator=torch.Generator(device="cpu").manual_seed(int(semente)),
            ).images[0]
            return png(img)


@app.function(image=imagem_web, secrets=[modal.Secret.from_name("estudio-ia")])
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Header, HTTPException, Response
    from pydantic import BaseModel

    web = FastAPI()

    def conferir(auth: str):
        if not hmac.compare_digest(auth or "", "Bearer " + os.environ["APP_KEY"]):
            raise HTTPException(status_code=401)

    class Pedido(BaseModel):
        tipo: str = "clipe"
        prompt: str
        imagem: str = ""
        negativo: str = ""
        segundos: float = 5.0
        passos: int = 0
        semente: int = 42
        largura: int = 720
        altura: int = 1280

    @web.get("/plano")
    def plano(authorization: str = Header(default="")):
        conferir(authorization)
        return {"plano": PLANO}

    @web.post("/gerar")
    def gerar(p: Pedido, authorization: str = Header(default="")):
        conferir(authorization)
        if p.tipo == "imagem":
            chamada = Imagem().gerar.spawn(p.prompt, p.largura, p.altura, p.semente)
        elif p.tipo == "clipe" and p.imagem:
            chamada = Clipe().gerar.spawn(
                base64.b64decode(p.imagem), p.prompt, p.negativo, p.segundos, p.passos, p.semente
            )
        else:
            raise HTTPException(status_code=400, detail="tipo 'imagem', ou 'clipe' com imagem")
        return {"id": chamada.object_id}

    @web.get("/resultado/{id}")
    def resultado(id: str, authorization: str = Header(default="")):
        conferir(authorization)
        try:
            dados = modal.FunctionCall.from_id(id).get(timeout=0)
        except Exception as e:
            if "Timeout" in type(e).__name__:
                return Response(status_code=202, content="gerando")
            return Response(status_code=500, content=f"{type(e).__name__}: {e}"[:4000])
        tipo = "image/png" if dados[:4] == b"\x89PNG" else "video/mp4"
        return Response(content=dados, media_type=tipo)

    return web
