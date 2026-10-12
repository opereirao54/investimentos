# Diagnóstico — Metas de saldo não ficam salvas — 12/10/2026

## Sintoma relatado

Em Configurações → Metas de saldo, as metas digitadas "não ficam salvas".
Relatado no celular; avaliar também no computador.

## Cadeia de persistência

campo (`#metaVerde` / `#metaVermelha`) → `salvarMetasEAtualizar()` →
`localStorage` (`futurorico_metaVerde` / `futurorico_metaVermelha`) →
interceptador do `setItem` (utils) → `AppliqueiCloudSync.onLocalWrite` →
`/api/sync/push` → Firestore → pull no outro aparelho → `carregarMetas()` no
`window.onload` → campo → Controle lia `parseBRL(#metaVerde.value)`.

## Teste divisor (Etapa 1)

Reprodução no Chromium (celular 390px e computador 1366px): digitar 5.000,00 /
1.500,00, tocar em "Salvar metas", fechar, reabrir, recarregar.

- Após "Salvar metas": `localStorage` = `5000` / `1500` → **a escrita funciona**.
- Após recarregar: `localStorage` ainda `5000` / `1500`, mas o campo mostrava
  `3000` cru (sem formatação) → o valor salvo **não era lido de volta**.

## Suspeitos verificados

| Suspeito                                    | Veredito                | Evidência                                                                                                                                    |
| ------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor recusa a chave (S5)                | DESCARTADO              | `isSyncKey` aceita `futurorico_*`; push sem `not_syncable`                                                                                   |
| Sair sem "Salvar metas" descarta o digitado | **CONFIRMADO**          | `fecharModalConfig` (PR #155) recarregava o salvo por cima do digitado; voltar ("‹ Configurações") também não salvava                        |
| Leitura depende do campo da tela            | **CONFIRMADO**          | Controle lia `#metaVerde.value`; se o `window.onload` não chegasse a `carregarMetas()`, a meta salva era ignorada (o campo ficava no padrão) |
| Campo vazio grava meta 0                    | CONFIRMADO (secundário) | `parseBRL('')` = 0 era gravado                                                                                                               |

## Causa raiz

1. No celular a pessoa digita e volta/fecha, como em qualquer app; só o botão
   "Salvar metas" gravava, e sair descartava o digitado.
2. O Controle usava o campo da tela como fonte da verdade, não o valor salvo.

## Correção

- `obterMetas()`: fonte única, lida do `localStorage` (padrão 3.000 / 1.000
  para ausente ou inválido). O Controle passa a usá-la.
- Salvamento automático: ao sair do campo (`onchange`), ao voltar e ao fechar
  as Configurações — com aviso "Metas salvas!". O botão continua.
- Campo vazio não apaga a meta; abrir as Configurações sempre mostra o salvo.

## Prova

Chromium, cinco caminhos de saída — celular: voltar, fechar, botão;
computador: fechar, clicar fora. Em todos, após recarregar a página:
`localStorage` = `7200` / `2100`, `obterMetas()` = 7200 / 2100, campos
`7.200,00` / `2.100,00`. Testes: `test/metas-saldo.test.js`.

## Pendências

- Prova no celular físico com conta logada (sincronização com a nuvem).
