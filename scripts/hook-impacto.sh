#!/usr/bin/env bash
# Hook PostToolUse: análise de impacto + EXECUÇÃO das provas após editar web/.
#
# Lê o JSON do hook em stdin, extrai o caminho editado e — só para web/*.js —
# cruza o diff DAQUELE arquivo com o mapa de contratos, RODA os testes que a
# análise apontou, e devolve o resultado como additionalContext.
#
# O escopo importa: sem passar o arquivo, a análise olharia o diff inteiro do
# working tree e reportaria contrato de OUTRA alteração pendente, sem relação
# com a edição que acabou de acontecer.
#
# Por que NÃO bloqueia (exit 2):
#   No meio de um refactor os testes falham legitimamente entre uma edição e a
#   seguinte. Bloquear ali brigaria com o trabalho e ensinaria a ignorar o
#   aviso. A pirâmide é outra: aqui é feedback rápido, o portão duro é o
#   pre-commit (.husky/pre-commit) e o CI em toda branch.
#
# Cala a boca em todo o resto: arquivo fora de web/, sem contrato declarado, ou
# alteração que não toca símbolo crítico. É isso que permite deixá-lo ligado sem
# virar ruído em mudança de CSS ou de texto.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRADA="$(cat)"

ARQUIVO="$(printf '%s' "$ENTRADA" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
[ -n "$ARQUIVO" ] || exit 0

REL="${ARQUIVO#"$RAIZ"/}"
case "$REL" in
  web/*.js) ;;
  *) exit 0 ;;
esac

cd "$RAIZ" || exit 0

IMPACTO="$(node scripts/impacto-integracoes.js --silencioso "$REL" 2>/dev/null)"
[ -n "$IMPACTO" ] || exit 0

# Provas que a análise apontou para os contratos em risco.
PROVAS="$(node scripts/impacto-integracoes.js --testes "$REL" 2>/dev/null)"

RESULTADO=""
if [ -n "$PROVAS" ]; then
  SAIDA="$(eval "$PROVAS" 2>&1)"
  STATUS=$?
  if [ $STATUS -eq 0 ]; then
    QTD="$(printf '%s' "$SAIDA" | grep -cE '^# pass' >/dev/null 2>&1 && printf '%s' "$SAIDA" | grep -E '^# pass' | head -1 || echo '')"
    RESULTADO="$(printf 'PROVAS: verdes (%s).\n' "${QTD:-ok}")"
  else
    FALHAS="$(printf '%s' "$SAIDA" | grep -E '^not ok' | head -8)"
    # O detalhe exclui as linhas de `not ok` e de `# Subtest`, senão o mesmo
    # teste aparece três vezes e o diagnóstico útil fica soterrado.
    DETALHE="$(printf '%s' "$SAIDA" \
      | grep -E 'INV-[0-9]+|EXCEÇÃO|MUTAÇÃO FANTASMA|PATRIMÔNIO (MEXEU|ERRADO)|DEVERIA TER RECUSADO' \
      | grep -vE '^(not ok|# Subtest|ok )' | head -6)"
    RESULTADO="$(printf 'PROVAS: FALHARAM.\n%s\n%s\n\nCorrija ANTES de seguir. Leia a `regra` e a `fragilidade` inteiras no mapa antes de concluir que o código está errado — a invariante também pode estar.\n' "$FALHAS" "$DETALHE")"
  fi
fi

jq -n --arg ctx "$IMPACTO" --arg res "$RESULTADO" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("Análise de impacto de integrações (mapa em .claude/integracoes/mapa.json).\n" + $ctx + "\n" + $res)
  },
  suppressOutput: true
}'
