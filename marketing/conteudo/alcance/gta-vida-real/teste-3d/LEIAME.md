# Testes 3D (19/11/2026) · NÃO PUBLICAR

- `cena.html` → `../teste-3d.png`: cena feita só com formas simples (caixas,
  cilindros). Ficou com cara de massinha.
- `teto.html` → `../teste-3d-modelo-pronto.png`: o teto do motor com um modelo
  profissional. O carro é o modelo de exemplo do three.js (licença **não
  comercial**: só para mostrar o nível, nunca em post); a luz é o HDR
  `venice_sunset_1k` (Poly Haven, CC0).

Para abrir: three@0.160.0 (`three.module.js` e `examples/jsm` ao lado) e os
arquivos em `mod/` (raw.githubusercontent.com/mrdoob/three.js/r160/examples),
servidos por HTTP (`python3 -m http.server`), porque os loaders usam fetch.
- `kenney.html` → `../teste-3d-kenney.png`: modelos Kenney (CC0), baixados com
  `git clone` dos repositórios públicos `KenneyNL/Starter-Kit-City-Builder`,
  `-Racing` e `-3D-Platformer` (os sites kenney.nl, Poly Haven, Quaternius e
  poly.pizza não abrem desta rede; o GitHub abre). Cada kit tem o próprio
  `Textures/colormap.png`: manter as pastas separadas. Luz: HDR
  `venice_sunset_1k` (CC0). Este é o nível que dá para publicar sem pagar
  modelos.
- `teto-cc.html` → `../teste-3d-carro-cc-by.png`: o mesmo nível do carro de
  exemplo, mas com um modelo que **pode ser publicado**: "Car Concept", de Eric
  Chadwick (Khronos glTF-Sample-Assets, CC BY 4.0: dar o crédito na legenda),
  baixado de raw.githubusercontent.com. Outros realistas e liberados no mesmo
  repositório: ToyCar e SheenChair (CC0), GlamVelvetSofa (CC BY 4.0).
