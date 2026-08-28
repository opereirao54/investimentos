#!/usr/bin/env bash
# Hook PostToolUse: análise de impacto de integrações após editar um arquivo de web/.
#
# Lê o JSON do hook em stdin, extrai o caminho editado e — só para web/*.js —
# roda a análise de impacto. Devolve o resultado como additionalContext para
# que a IA veja quais contratos entram em risco antes de seguir.
#
# Cala a boca em todo o resto: arquivo fora de web/, arquivo sem contrato
# declarado no mapa, ou alteração que não toca símbolo crítico. É isso que
# permite deixá-lo ligado sem virar ruído em mudança de CSS ou de texto.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRADA="$(cat)"

ARQUIVO="$(printf '%s' "$ENTRADA" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
[ -n "$ARQUIVO" ] || exit 0

# Normaliza para caminho relativo à raiz do repo.
REL="${ARQUIVO#"$RAIZ"/}"
case "$REL" in
  web/*.js) ;;
  *) exit 0 ;;
esac

SAIDA="$(cd "$RAIZ" && node scripts/impacto-integracoes.js --silencioso 2>/dev/null)"
[ -n "$SAIDA" ] || exit 0

jq -n --arg ctx "$SAIDA" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("Análise de impacto de integrações (mapa em .claude/integracoes/mapa.json).\nRode as provas listadas antes de considerar a alteração pronta.\n" + $ctx)
  },
  suppressOutput: true
}'
