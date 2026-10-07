#!/usr/bin/env bash
# Baixa as fontes da marca do Google Fonts e as embute como base64 em
# .fontes.css, que gerar.js consome.
#
# O CSS gerado NÃO vai para o repositório: são ~400 KB de blob regenerável,
# e versionar binário que um comando reconstrói só engorda o histórico.
# Rode isto uma vez antes de gerar as peças.
set -euo pipefail
cd "$(dirname "$0")"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

for f in "Syne:wght@700;800" "Figtree:wght@400;500;600;700;900" "DM+Mono:wght@400;500"; do
  curl -fsS -m 30 -A "$UA" "https://fonts.googleapis.com/css2?family=${f}&display=swap" >> "$tmp/css.txt"
done
grep -oE "https://fonts.gstatic.com[^)]*\.woff2" "$tmp/css.txt" | sort -u | while read -r u; do
  curl -fsS -m 30 -o "$tmp/$(basename "$u")" "$u"
done

python3 - "$tmp" <<'PY'
import re, io, os, sys, base64
tmp = sys.argv[1]
css = io.open(os.path.join(tmp, 'css.txt'), encoding='utf-8').read()
faces = []
for sub, corpo in re.findall(r'/\*\s*([\w-]+)\s*\*/\s*@font-face\s*{(.*?)}', css, re.S):
    if sub not in ('latin', 'latin-ext'):   # português precisa dos dois
        continue
    fam  = re.search(r"font-family:\s*'([^']+)'", corpo).group(1)
    peso = re.search(r'font-weight:\s*([\d ]+)', corpo).group(1).strip()
    arq  = os.path.join(tmp, os.path.basename(re.search(r'url\((https://[^)]+)\)', corpo).group(1)))
    if not os.path.exists(arq):
        continue
    faces.append("@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:block;"
                 "src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s;}"
                 % (fam, peso, base64.b64encode(open(arq,'rb').read()).decode(),
                    re.search(r'unicode-range:\s*([^;]+);', corpo).group(1).strip()))
io.open('.fontes.css', 'w', encoding='utf-8').write('\n'.join(faces))
print('.fontes.css · %d faces · %d KB' % (len(faces), os.path.getsize('.fontes.css') / 1024))
PY
