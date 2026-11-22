#!/usr/bin/env python3
"""Gera imagem ou clipe de IA sem ficar parado quando uma cota acaba.

Tenta cada fornecedor em ordem e passa ao proximo quando um falha (cota
esgotada, fila, erro, fornecedor nao configurado):

  imagem: cloudflare FLUX.2 klein 4B no Workers AI (gratis, sem cartao; ~60
                 imagens 720x1280 por dia; testado em 22/11)
          hf     FLUX.1 schnell no Space gratis do Hugging Face (cota diaria;
                 cada imagem reserva 70 s dos 300 s do dia: deixar para clipes)
          modal  FLUX.1 schnell no estudio do Modal (creditos gratis)
          gemini modelo de imagem do Gemini (GEMINI_API_KEY; cota pequena)
          local  1 quadro do Wan 2.2 5B Turbo no processador: RASCUNHO (~100 s)
  clipe:  hf     Wan 2.2 14B Lightning no Space gratis (o dos clipes aprovados)
          modal  a mesma receita no estudio do Modal
          local  Wan 2.2 5B Turbo no processador desta maquina: RASCUNHO
                 (~2 min por 0,7 s; manchas perto de bracos e maos)

Uso:
  python3 ia.py imagem "<prompt>" saida.png [--largura 720 --altura 1280 --semente 7]
  python3 ia.py clipe inicio.png "<prompt>" saida.mp4 [--segundos 5 --semente 42]
  python3 ia.py editar ref.png[,ref2.png] "<prompt>" saida.jpg [--largura 720 --altura 1280]
      # nova cena a partir de imagem(ns) de referencia (Cloudflare FLUX.2 klein):
      # mantem o mesmo rosto e roupa dos personagens; ex.: "Only the man in the
      # red t-shirt ... Keep exactly the same character, same art style"
  python3 ia.py preparar-local   # compila o stable-diffusion.cpp e baixa ~9 GB
  --so hf,modal                  # usa so esses fornecedores, nessa ordem

Variaveis: IA_CF_ACCOUNT (Account ID da Cloudflare; o token vai em
Authorization, injetado pela rede do ambiente ou em IA_CF_TOKEN); HF_TOKEN (Space); IA_MODAL_URL (endereco do estudio no Modal; a
chave vai em Authorization, injetada pela rede do ambiente ou em IA_MODAL_KEY);
GEMINI_API_KEY; IA_LOCAL_DIR (padrao ~/.cache/ia-local).
Precisa de: pip install httpx numpy; ffmpeg. O estudio do Modal e publicado
pelo repositorio investimentos (marketing/ferramentas/ia-video/modal_app.py).

Esta ferramenta existe em copias identicas e independentes em cada projeto
(cada uma no seu lugar; nenhuma importa a outra).
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

FLUX_SPACE = "black-forest-labs-flux-1-schnell.hf.space"
WAN_SPACE = "zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space"
NEGATIVO = (
    "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, "
    "最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, "
    "画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, "
    "杂乱的背景, 三条腿, 背景人很多, 倒着走, text, watermark, logo"
)
LOCAL = os.path.expanduser(os.environ.get("IA_LOCAL_DIR", "~/.cache/ia-local"))


class Pula(Exception):
    """O fornecedor nao serve agora (cota, configuracao, erro): tenta o proximo."""


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def salvar(dados, saida, ext_origem):
    """Grava os bytes; converte (ex.: webp -> png) quando a extensao difere."""
    if saida.lower().endswith(ext_origem):
        open(saida, "wb").write(dados)
        return
    with tempfile.NamedTemporaryFile(suffix=ext_origem) as t:
        t.write(dados)
        t.flush()
        ffmpeg("-i", t.name, saida)


# ---------- Hugging Face Space (Gradio), numa conexao so ----------
def space(host, api, dados):
    """Chama um Space Gradio pela mesma conexao do inicio ao fim (pelo proxy da
    nuvem, cada conexao nova cai em outra replica e a fila se perde)."""
    import httpx

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise Pula("sem HF_TOKEN")
    h = {"Authorization": "Bearer " + token}
    with httpx.Client(base_url=f"https://{host}", headers=h, timeout=httpx.Timeout(60, read=900)) as c:
        info = c.get("/config").json()
        fn = next(i for i, d in enumerate(info["dependencies"]) if d.get("api_name") == api)

        def sobe(v):
            if isinstance(v, str) and v.startswith("@"):
                p = v[1:]
                r = c.post("/gradio_api/upload", files={"files": (os.path.basename(p), open(p, "rb"))})
                r.raise_for_status()
                return {"path": r.json()[0], "orig_name": os.path.basename(p), "meta": {"_type": "gradio.FileData"}}
            return v

        sess = uuid.uuid4().hex[:11]
        corpo = {"data": [sobe(v) for v in dados], "fn_index": fn, "session_hash": sess, "event_data": None, "trigger_id": None}
        c.post("/gradio_api/queue/join", json=corpo).raise_for_status()
        caminho = None
        with c.stream("GET", "/gradio_api/queue/data", params={"session_hash": sess}) as s:
            for linha in s.iter_lines():
                if not linha.startswith("data:"):
                    continue
                m = json.loads(linha[5:])
                if m.get("msg") == "process_completed":
                    o = m.get("output", {})
                    if not m.get("success"):
                        raise Pula("Space: " + json.dumps(o, ensure_ascii=False)[:300])
                    v = o["data"][0]
                    v = v.get("video", v) if isinstance(v, dict) else v
                    caminho = v["path"] if isinstance(v, dict) else v
        if not caminho:
            raise Pula("Space terminou sem resultado")
        for _ in range(6):
            d = c.get("/gradio_api/file=" + caminho)
            if d.status_code == 200:
                return d.content
            time.sleep(2)
        raise Pula(f"Space: download {d.status_code}")


# ---------- Modal (estudio-ia) ----------
def modal(pedido):
    import httpx

    url = os.environ.get("IA_MODAL_URL", "").rstrip("/")
    if not url:
        raise Pula("sem IA_MODAL_URL")
    h = {"Authorization": "Bearer " + os.environ.get("IA_MODAL_KEY", "chave-injetada-pela-rede")}
    with httpx.Client(headers=h, timeout=120) as c:
        r = c.post(url + "/gerar", json=pedido)
        if r.status_code != 200:
            raise Pula(f"Modal {r.status_code}: {r.text[:200]}")
        id_ = r.json()["id"]
        fim = time.time() + 30 * 60  # a 1a vez baixa o modelo e demora
        while time.time() < fim:
            r = c.get(f"{url}/resultado/{id_}")
            if r.status_code == 200:
                return r.content
            if r.status_code != 202:
                raise Pula(f"Modal {r.status_code}: {r.text[:300]}")
            time.sleep(10)
    raise Pula("Modal: passou de 30 min")


# ---------- Cloudflare Workers AI (so imagem) ----------
def cloudflare_imagem(prompt, largura, altura, semente, refs=()):
    """FLUX.2 klein 4B. Com refs (imagens de referencia, campos input_image_0..),
    edita/compoe a partir delas e mantem os personagens. O filtro da Cloudflare
    as vezes barra um resultado inocente ("Your output has been flagged"):
    tenta outras 2 sementes antes de desistir."""
    import httpx

    conta = os.environ.get("IA_CF_ACCOUNT")
    if not conta:
        raise Pula("sem IA_CF_ACCOUNT")
    h = {"Authorization": "Bearer " + os.environ.get("IA_CF_TOKEN", "chave-injetada-pela-rede")}
    url = f"https://api.cloudflare.com/client/v4/accounts/{conta}/ai/run/@cf/black-forest-labs/flux-2-klein-4b"
    ultimo = ""
    for s in (semente, semente + 1, semente + 2):
        campos = {
            "prompt": (None, prompt),
            "width": (None, str(max(256, min(1536, int(largura) // 16 * 16)))),
            "height": (None, str(max(256, min(1536, int(altura) // 16 * 16)))),
            "seed": (None, str(s)),
        }
        for i, ref in enumerate(refs):
            campos[f"input_image_{i}"] = (os.path.basename(ref), open(ref, "rb").read())
        r = httpx.post(url, headers=h, files=campos, timeout=180)
        if r.status_code == 200 and r.json().get("success", True):
            return base64.b64decode(r.json()["result"]["image"]), ".jpg"
        ultimo = f"Cloudflare {r.status_code}: {r.text[:300]}"
        if "flagged" not in r.text:
            break
    raise Pula(ultimo)


# ---------- Gemini (so imagem) ----------
def gemini_imagem(prompt):
    import httpx

    chave = os.environ.get("GEMINI_API_KEY")
    if not chave:
        raise Pula("sem GEMINI_API_KEY")
    for modelo in ("gemini-3.1-flash-image", "gemini-2.5-flash-image"):
        corpo = {"contents": [{"parts": [{"text": prompt + ". Vertical 9:16."}]}], "generationConfig": {"responseModalities": ["IMAGE"]}}
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
            headers={"x-goog-api-key": chave}, json=corpo, timeout=180,
        )
        if r.status_code != 200:
            continue
        for p in r.json()["candidates"][0]["content"]["parts"]:
            if "inlineData" in p:
                return base64.b64decode(p["inlineData"]["data"]), "." + p["inlineData"].get("mimeType", "image/png").split("/")[-1]
    raise Pula("Gemini sem imagem (cota?)")


def salvar_gemini(resultado, saida):
    dados, ext = resultado
    salvar(dados, saida, ext)


# ---------- local (processador) ----------
def local_clipe(inicio, prompt, saida, segundos, semente):
    cli = os.path.join(LOCAL, "sd/build/bin/sd-cli")
    m = os.path.join(LOCAL, "modelos")
    if not os.path.exists(cli):
        raise Pula("local nao preparado (rode: ia.py preparar-local)")
    q = max(9, min(49, int(segundos * 24) // 4 * 4 + 1))  # Wan: 4k+1 quadros
    with tempfile.TemporaryDirectory() as d:
        r = subprocess.run([
            cli, "-M", "vid_gen", "--diffusion-model", f"{m}/wan-turbo-q4km.gguf",
            "--vae", f"{m}/wan2.2_vae.safetensors", "--tae", f"{m}/taew2_2.safetensors",
            "--t5xxl", f"{m}/umt5-q4km.gguf", "-p", prompt, "-n", "static, blurry, deformed, extra fingers, text, watermark",
            "-i", inicio, "--cfg-scale", "1.0", "--sampling-method", "euler", "--steps", "4",
            "--flow-shift", "3.0", "-W", "384", "-H", "672", "--video-frames", str(q),
            "-t", str(os.cpu_count() or 4), "-s", str(semente), "-o", f"{d}/q_%03d.png",
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise Pula("local falhou: " + (r.stderr or r.stdout)[-300:])
        ffmpeg("-framerate", "24", "-i", f"{d}/q_%03d.png", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", saida)


def local_imagem(prompt, saida, largura, altura, semente):
    """Imagem parada = video de 1 quadro do mesmo Wan 2.2 5B (~100 s, sem baixar nada a mais)."""
    cli = os.path.join(LOCAL, "sd/build/bin/sd-cli")
    m = os.path.join(LOCAL, "modelos")
    if not os.path.exists(cli):
        raise Pula("local nao preparado (rode: ia.py preparar-local)")
    # lados multiplos de 32 e no maximo 704x1280 (acima disso falta memoria)
    esc = min(1.0, 704 / max(1, min(largura, altura)), 1280 / max(1, max(largura, altura)))
    w, h = (max(256, int(v * esc) // 32 * 32) for v in (largura, altura))
    with tempfile.TemporaryDirectory() as d:
        r = subprocess.run([
            cli, "-M", "vid_gen", "--diffusion-model", f"{m}/wan-turbo-q4km.gguf",
            "--vae", f"{m}/wan2.2_vae.safetensors", "--tae", f"{m}/taew2_2.safetensors",
            "--t5xxl", f"{m}/umt5-q4km.gguf", "-p", prompt, "-n", "blurry, deformed, text, watermark",
            "--cfg-scale", "1.0", "--sampling-method", "euler", "--steps", "4", "--flow-shift", "3.0",
            "-W", str(w), "-H", str(h), "--video-frames", "1", "-t", str(os.cpu_count() or 4),
            "-s", str(semente), "-o", f"{d}/q_%03d.png",
        ], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(f"{d}/q_000.png"):
            raise Pula("local falhou: " + (r.stderr or r.stdout)[-300:])
        salvar(open(f"{d}/q_000.png", "rb").read(), saida, ".png")


def pth_para_safetensors(pth, saida):
    """Converte o .pth do decodificador leve para safetensors sem precisar do torch."""
    import collections
    import pickle
    import struct
    import zipfile

    import numpy as np

    z = zipfile.ZipFile(pth)
    raiz = z.namelist()[0].split("/")[0]
    TIPOS = {"HalfStorage": ("F16", 2, np.float16), "FloatStorage": ("F32", 4, np.float32), "BFloat16Storage": ("BF16", 2, np.uint16)}

    class U(pickle.Unpickler):
        def find_class(self, mod, nome):
            if (mod, nome) == ("torch._utils", "_rebuild_tensor_v2"):
                return lambda st, off, size, stride, *a: (st, off, tuple(size), tuple(stride))
            if (mod, nome) == ("collections", "OrderedDict"):
                return collections.OrderedDict
            if mod == "torch" and nome in TIPOS:
                return nome
            raise pickle.UnpicklingError(f"{mod}.{nome} nao permitido")

        def persistent_load(self, pid):
            return (pid[1], pid[2])

    estado = U(z.open(f"{raiz}/data.pkl")).load()
    cab, partes, pos = {}, [], 0
    for nome, ((tipo, chave), off, size, stride) in estado.items():
        dt, es, npt = TIPOS[tipo]
        a = np.frombuffer(z.read(f"{raiz}/data/{chave}"), dtype=npt)
        n = int(np.prod(size)) if size else 1
        a = np.lib.stride_tricks.as_strided(a[off:], shape=size, strides=[s * es for s in stride]) if size else a[off : off + 1]
        b = np.ascontiguousarray(a).tobytes()[: n * es]
        cab[nome] = {"dtype": dt, "shape": list(size), "data_offsets": [pos, pos + len(b)]}
        partes.append(b)
        pos += len(b)
    h = json.dumps(cab, separators=(",", ":")).encode()
    h += b" " * (-len(h) % 8)
    with open(saida, "wb") as f:
        f.write(struct.pack("<Q", len(h)) + h)
        for b in partes:
            f.write(b)


def preparar_local():
    """Compila o stable-diffusion.cpp e baixa o Wan 2.2 5B Turbo (Apache 2.0)."""
    m = os.path.join(LOCAL, "modelos")
    os.makedirs(m, exist_ok=True)
    sd = os.path.join(LOCAL, "sd")
    if not os.path.exists(os.path.join(sd, "build/bin/sd-cli")):
        if not os.path.exists(sd):
            subprocess.run(["git", "clone", "-q", "--depth", "1", "--recursive", "https://github.com/leejet/stable-diffusion.cpp", sd], check=True)
        subprocess.run(["cmake", "-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DGGML_NATIVE=ON"], cwd=sd, check=True, capture_output=True)
        subprocess.run(["cmake", "--build", "build", "-j", str(os.cpu_count() or 4), "--config", "Release"], cwd=sd, check=True, capture_output=True)
    hf = "https://huggingface.co"
    arquivos = {
        "wan-turbo-q4km.gguf": f"{hf}/hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF/resolve/main/Wan2_2-TI2V-5B-Turbo-Q4_K_M.gguf",
        "umt5-q4km.gguf": f"{hf}/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf",
        "wan2.2_vae.safetensors": f"{hf}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
        "taew2_2.pth": f"{hf}/Runware/taew22/resolve/main/taew2_2.pth",
    }
    for nome, url in arquivos.items():
        for _ in range(4):  # retoma downloads cortados
            if subprocess.run(["curl", "-sfL", "-C", "-", "-o", os.path.join(m, nome), url]).returncode == 0:
                break
        else:
            sys.exit(f"falhou o download de {nome}")
    if not os.path.exists(os.path.join(m, "taew2_2.safetensors")):
        pth_para_safetensors(os.path.join(m, "taew2_2.pth"), os.path.join(m, "taew2_2.safetensors"))
    print("local pronto em", LOCAL)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("acao", choices=["imagem", "editar", "clipe", "preparar-local"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--largura", type=int, default=720)
    ap.add_argument("--altura", type=int, default=1280)
    ap.add_argument("--segundos", type=float, default=5.0)
    ap.add_argument("--semente", type=int, default=42)
    ap.add_argument("--so", default="")
    a = ap.parse_args()
    if a.acao == "preparar-local":
        return preparar_local()

    if a.acao == "editar":
        # so a Cloudflare edita com referencia; sem ela, nao cai para geracao
        # comum (mudaria o rosto dos personagens sem avisar)
        refs, prompt, saida = a.args[0].split(","), a.args[1], a.args[2]
        try:
            salvar_gemini(cloudflare_imagem(prompt, a.largura, a.altura, a.semente, refs), saida)
            print(f"[cloudflare] ok -> {saida}")
        except Exception as e:
            sys.exit(f"[cloudflare] falhou: {e}")
        return

    if a.acao == "imagem":
        prompt, saida = a.args
        ordem = {
            "cloudflare": lambda: salvar_gemini(cloudflare_imagem(prompt, a.largura, a.altura, a.semente), saida),
            "hf": lambda: salvar(space(FLUX_SPACE, "infer", [prompt, a.semente, False, a.largura, a.altura, 4]), saida, ".webp"),
            "modal": lambda: salvar(modal({"tipo": "imagem", "prompt": prompt, "largura": a.largura, "altura": a.altura, "semente": a.semente}), saida, ".png"),
            "gemini": lambda: salvar_gemini(gemini_imagem(prompt), saida),
            "local": lambda: local_imagem(prompt, saida, a.largura, a.altura, a.semente),
        }
    else:
        inicio, prompt, saida = a.args
        b64 = base64.b64encode(open(inicio, "rb").read()).decode()
        ordem = {
            "hf": lambda: salvar(space(WAN_SPACE, "generate_video", ["@" + inicio, prompt, 4, NEGATIVO, min(a.segundos, 5.0), 1, 1, a.semente, False]), saida, ".mp4"),
            "modal": lambda: salvar(modal({"tipo": "clipe", "imagem": b64, "prompt": prompt, "segundos": a.segundos, "semente": a.semente}), saida, ".mp4"),
            "local": lambda: local_clipe(inicio, prompt, saida, a.segundos, a.semente),
        }
    nomes = [n for n in a.so.split(",") if n] or list(ordem)
    for nome in nomes:
        try:
            print(f"[{nome}] tentando...", flush=True)
            ordem[nome]()
            aviso = "  (RASCUNHO: qualidade menor)" if nome == "local" else ""
            print(f"[{nome}] ok -> {saida}{aviso}")
            return
        except Exception as e:  # Pula ou erro inesperado: segue para o proximo
            print(f"[{nome}] pulou: {e}", flush=True)
    sys.exit("nenhum fornecedor conseguiu; veja as mensagens acima")


if __name__ == "__main__":
    main()
