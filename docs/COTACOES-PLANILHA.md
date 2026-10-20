# Cotações pela planilha Google (GOOGLEFINANCE)

## Por que

O Yahoo recusa (erro 429) pedidos vindos de servidores de nuvem. Foi medido
na Vercel e no GitHub Actions: 35 de 35 ativos recusados. A página do Google
Finance chega ao servidor sem o preço. A função `GOOGLEFINANCE` do Google
Planilhas busca a cotação do lado do Google e não sofre esse bloqueio.

Um script na sua planilha vira um endereço que o Appliquei chama com a lista
de códigos e recebe os preços. Ele é usado pelo servidor (`op=quote`) e pelo
job **Cotações** (GitHub Actions). É grátis e tem atraso de até 20 minutos,
como o próprio Google Finance.

## Instalar (uma vez, uns 10 minutos, de preferência no computador)

O editor de scripts do Google não funciona bem no celular.

1. **Crie a planilha.** Em <https://sheets.new>, com a conta Google que vai
   ficar dona disso, dê o nome "Appliquei cotações".
2. **Cole o script.** Na planilha: **Extensões → Apps Script**. Apague o que
   estiver no editor e cole todo o conteúdo de
   [`scripts/planilha-cotacoes/Codigo.gs`](../scripts/planilha-cotacoes/Codigo.gs).
   Na linha `var SEGREDO = 'TROQUE-ESTE-SEGREDO';`, troque o texto entre
   aspas por uma senha longa e aleatória, de 30 caracteres ou mais, só com
   letras e números. Salve (ícone do disquete).
3. **Teste.** No editor, escolha a função `testar` na lista do topo e clique
   em **Executar**. Na primeira vez o Google pede autorização: **Revisar
   permissões** → sua conta → **Avançado** → **Acessar (não seguro)** →
   **Permitir**. O script é seu e só mexe nesta planilha. Abra o **Registro de
   execução**: deve aparecer algo como
   `{"cotacoes":{"WEGE3":{"price":47.67,…},"ITUB4":{…}}}`.
4. **Publique como app da web.** **Implantar → Nova implantação** →
   engrenagem → **App da Web**:
   - _Executar como_: **Eu**
   - _Quem pode acessar_: **Qualquer pessoa**

   Clique em **Implantar** e copie o **URL do app da Web**, que termina em
   `/exec`. "Qualquer pessoa" é o necessário para o servidor conseguir chamar;
   sem o SEGREDO, o endereço só responde `nao_autorizado`.

5. **Cadastre nos dois lugares.**
   - **Vercel** → projeto → Settings → Environment Variables (Production):
     - `COTACAO_PLANILHA_URL` = o URL do passo 4
     - `COTACAO_PLANILHA_SEGREDO` = o mesmo SEGREDO do passo 2

     Depois faça um **Redeploy**.

   - **GitHub** → repositório → Settings → Secrets and variables → Actions →
     New repository secret: os mesmos dois nomes, com os mesmos valores.

## Conferir

GitHub → **Actions** → **Cotações** → **Run workflow**. Em cerca de 1 minuto o
log mostra `cotados: N/N {"planilha":N}`. No app, o formulário de operação
passa a dizer "Cotação de … · Google Finance".

## Se algo der errado

| No log do job / no aviso do app | O que é                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `planilha_nao_autorizado`       | SEGREDO diferente entre o script e a Vercel/GitHub                         |
| `planilha_resposta_nao_json`    | A implantação não está como "Qualquer pessoa", ou o URL não é o de `/exec` |
| `planilha_timeout`              | O Google demorou mais de 12 s; a próxima rodada tenta de novo              |
| ativo em "sem preço"            | Código que o GOOGLEFINANCE não conhece (ativo deslistado ou código errado) |

Mudou o script? **Implantar → Gerenciar implantações → editar → Nova
versão**. O URL continua o mesmo.

## Ordem das fontes (servidor e job)

1. BRAPI, se `BRAPI_TOKEN` existir;
2. **planilha**, se `COTACAO_PLANILHA_URL` existir;
3. Yahoo em lote (`v7/quote` com cookie + crumb);
4. Yahoo `v8/chart`, um ativo por vez;
5. Google Finance (página).
