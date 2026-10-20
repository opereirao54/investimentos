# Cotações pela planilha Google (GOOGLEFINANCE)

## Por que

O Yahoo recusa (erro 429) pedidos vindos de servidores de nuvem. Foi medido
na Vercel e no GitHub Actions: 35 de 35 ativos recusados. A página do Google
Finance chega ao servidor sem o preço. A função `GOOGLEFINANCE` do Google
Planilhas busca a cotação do lado do Google e não sofre esse bloqueio. É
grátis e tem atraso de até 20 minutos, como o próprio Google Finance.

## Como funciona

- A planilha tem uma aba **`cotacoes`**. Cada linha é um código na coluna A;
  as colunas B–E têm fórmulas `GOOGLEFINANCE("BVMF:"&INDIRECT("A"&ROW()), …)`
  com preço, fechamento anterior, variação % e nome.
- O servidor (`op=quote`) e o job **Cotações** leem a aba inteira num pedido
  só, pela API do Google Sheets. Usam a **mesma conta de serviço do Firebase**
  que já está na Vercel e no GitHub, então não há chave nova.
- Código que ainda não está na planilha é acrescentado sozinho. O Google o
  calcula em segundos, e a leitura seguinte já traz o preço.
- O id da planilha fica em `api/market.js` (`PLANILHA_ID_PADRAO`). A
  variável `COTACAO_PLANILHA_ID` troca de planilha sem mexer no código.

## Instalar (uma vez)

1. **Crie a planilha** em <https://sheets.new> e dê o nome "Appliquei
   cotações".
2. **Compartilhe com a conta de serviço** como **Editor**: botão
   Compartilhar → cole o e-mail → Editor → desmarque "Notificar" → Enviar.
   O e-mail termina em `@<projeto>.iam.gserviceaccount.com`. Onde achar:
   - Firebase → ⚙ Configurações do projeto → **Contas de serviço**; ou
   - o log do job **Cotações** (linha `· planilha … · conta …`).
3. **Mande o link da planilha** para quem mantém o código. A aba, as fórmulas
   e o id no código são configurados a partir dele.

## Conferir

GitHub → **Actions** → **Cotações** → **Run workflow**. O log mostra
`cotados: N/N {"planilha":N}`. No app, o formulário de operação diz
"Cotação de … · Google Finance".

## Se algo der errado

| No log do job / no aviso do app | O que é                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `planilha_403`                  | A planilha não foi compartilhada com a conta de serviço (passo 2)          |
| `planilha_404`                  | Id errado, ou planilha apagada                                             |
| `planilha_400`                  | Falta a aba `cotacoes`                                                     |
| `planilha_novo`                 | Código acabou de entrar; o preço vem na próxima leitura                    |
| ativo em "sem preço"            | Código que o GOOGLEFINANCE não conhece (ativo deslistado ou código errado) |

## Ordem das fontes (servidor e job)

1. BRAPI, se `BRAPI_TOKEN` existir;
2. **planilha** (GOOGLEFINANCE);
3. Yahoo em lote (`v7/quote` com cookie + crumb);
4. Yahoo `v8/chart`, um ativo por vez;
5. Google Finance (página).
