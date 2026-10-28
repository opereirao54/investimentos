"""Recorta o Appli da imagem de referência (gerada pelo fundador) e separa as
camadas para animar: corpo (moeda, braços e mãos) e pernas (pernas e tênis).

    pip install rembg onnxruntime pillow
    python3 marketing/mascote/appli/preparar.py

Gera appli-recorte.png (fundo transparente), corpo.png e pernas.png (2x).
"""
import os
from PIL import Image
from rembg import remove, new_session

AQUI = os.path.dirname(os.path.abspath(__file__))
ref = Image.open(os.path.join(AQUI, 'referencia.png')).convert('RGB')
rec = remove(ref.crop((400, 20, 860, 600)), session=new_session('isnet-general-use'))
rec.save(os.path.join(AQUI, 'appli-recorte.png'))

ESC = 2
grande = rec.resize((rec.width * ESC, rec.height * ESC), Image.LANCZOS)
corpo, pernas = grande.copy(), grande.copy()
pc, pp = corpo.load(), pernas.load()
for y in range(grande.height):
    for x in range(grande.width):
        X, Y = x / ESC, y / ESC
        no_corpo = Y < 398 or (X > 310 and Y < 430)  # moeda, braços e o punho direito
        if no_corpo:
            pp[x, y] = (0, 0, 0, 0)
        else:
            pc[x, y] = (0, 0, 0, 0)
corpo.save(os.path.join(AQUI, 'corpo.png'))
pernas.save(os.path.join(AQUI, 'pernas.png'))
print('gerado:', grande.size)
