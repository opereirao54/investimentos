---
name: diagnostico-de-persistencia
description: Protocolo sistemático para diagnosticar e corrigir bugs de persistência e sincronização de dados — dado cadastrado que não grava no banco, some, não sobe, ou não aparece em outro dispositivo ou sessão (ex. "cadastrei pelo celular e não aparece no PC", "funciona no computador mas não no celular", "salva às vezes sim às vezes não"). Localiza o elo exato da cadeia (evento → request → servidor → banco → leitura) com evidência ANTES de qualquer correção. Use esta skill sempre que o usuário relatar dado que não salva, não persiste, não sincroniza ou desaparece; quando disser que a IA já tentou corrigir várias vezes e não conseguiu; quando um bug de gravação/salvamento resistir à primeira tentativa de correção; ou quando descrever apenas o sintoma ("cadastro some", "não sobe pro banco") sem pedir diagnóstico explicitamente. Use também para o caminho inverso (PC → celular) e para dados que somem entre sessões no mesmo dispositivo.
---

# Diagnóstico de Persistência e Sincronização de Dados

**Princípio central: bug de "dado que some" não se resolve corrigindo código — se resolve localizando, com evidência, o elo exato da cadeia onde o dado se perde.** Só depois se corrige.

Por que a IA falha repetidamente nesse tipo de bug: o modelo só enxerga o código, e essa classe de bug quase nunca mora na lógica do código. Ela mora no **ambiente de execução** — cache servindo versão velha, identidade diferente por dispositivo, request morta pela navegação, regra de segurança negando escrita em silêncio, dado gravado mas filtrado na leitura. Ler o código com mais atenção não revela nada disso; só **evidência de runtime** revela. Cada "correção às cegas" ainda piora: adiciona código, muda comportamento e contamina a cena do crime, tornando o diagnóstico seguinte mais difícil que o primeiro.

**Regra de ouro: nenhuma correção antes de completar o diagnóstico (Etapas 0 a 3).** Se o usuário pedir "só arruma logo", explique em uma linha por que o diagnóstico é mais rápido que a quarta tentativa de chute — e siga o protocolo.

Conduza todo o trabalho em português brasileiro, salvo pedido contrário.

---

## Etapa 0 — Levantamento do cenário (5 perguntas, não 20)

Descubra pelo código o que puder (se tiver acesso ao repositório, leia antes de perguntar). Pergunte só o que faltar:

1. **Stack**: frontend (HTML puro? React? PWA instalado na tela inicial?), backend (Firebase? Supabase? API própria? Apps Script? nenhum?), banco, hospedagem.
2. **Autenticação**: login com conta? Anônima? Nenhuma? *(Auth anônima gera um usuário diferente por dispositivo — suspeito imediato.)*
3. **Reprodutibilidade**: falha 100% das vezes no celular? Em qual navegador/dispositivo? O caminho inverso (PC → celular) funciona?
4. **Eco local**: logo após salvar no celular, o dado **aparece na tela do próprio celular**? *(Se sim, existe escrita local otimista — a UI está mentindo sucesso enquanto a gravação remota falha. Pista forte.)*
5. **Histórico**: o que já foi tentado como correção? *(Para não repetir e para saber o que já contaminou o código.)*

### Verificação zero — existe banco compartilhado?

Antes de caçar o bug, confirme que há o que sincronizar. Procure no código do caminho de gravação: se as escritas vão para `localStorage`, `sessionStorage` ou `IndexedDB` **sem nenhuma chamada de rede** (fetch/axios/SDK de backend), o veredito é imediato: **não é bug, é arquitetura**. Esses armazenamentos vivem dentro de cada navegador de cada aparelho — o dado do celular nunca teve como chegar ao PC. Nesse caso, encerre o diagnóstico, explique isso ao usuário com clareza e proponha os caminhos de backend (Supabase, Firebase, API própria, Sheets + Apps Script), dimensionando pela escala do sistema. Não gaste instrumentação num bug que não existe.

## Etapa 1 — O teste que divide o problema ao meio

Antes de qualquer instrumentação, faça (ou peça ao usuário) **um único teste**: cadastrar um registro pelo celular com um valor único e rastreável (ex. descrição "TESTE-DIAG-1430") e, em seguida, **consultar o banco diretamente** — console admin do Firebase/Supabase, SQL, planilha — **sem nenhum filtro de usuário, data ou status**. Buscar pelo conteúdo.

O resultado corta a cadeia pela metade:

- **O registro ESTÁ no banco** → a escrita funciona. O problema é do lado da **leitura**: identidade (gravado sob outro `user_id` — compare os IDs!), filtro de data/timezone, cache de leitura no PC, paginação/ordenação. Vá aos suspeitos S7–S9.
- **O registro NÃO está no banco** → o problema é do lado da **escrita** no celular. Vá aos suspeitos S1–S6.

Registre o resultado com print/evidência. Este teste de 2 minutos economiza horas e é obrigatório antes da Etapa 2.

## Etapa 2 — Suspeitos usuais

Verifique em ordem (frequência real desse tipo de bug). Para cada um, produza veredito **CONFIRMADO / DESCARTADO / NÃO TESTÁVEL AINDA** com a evidência — nada de "provavelmente".

**Lado da escrita (registro não chegou ao banco):**

- **S1 — Celular rodando versão velha do app.** Service worker/cache de PWA servindo JavaScript de semanas atrás: o código que grava nem existe no aparelho. *Verificar:* exiba um número de versão no rodapé do app e compare celular × PC; no celular, desregistre o service worker / limpe dados do site e teste de novo. É o suspeito nº 1 em PWA e o mais invisível no código.
- **S2 — Request morta pela navegação.** No celular o usuário salva e imediatamente troca de app, bloqueia a tela ou a página navega — e o navegador móvel cancela fetches pendentes sem cerimônia. *Verificar:* a gravação é `await`-ada antes de qualquer navegação/feedback? *Correção típica:* aguardar a resposta antes de navegar, `fetch(..., {keepalive: true})` ou `navigator.sendBeacon` para gravações no fim do ciclo de vida.
- **S3 — Erro silencioso engolido.** `catch` vazio, promise rejeitada sem handler, resposta 4xx/5xx ignorada — o app falha sem contar a ninguém. *Verificar:* leia cada `catch` do caminho de gravação; a resposta HTTP é checada (`response.ok`)? "Não dá erro nenhum" não é informação: **erro silencioso é o modo padrão de falha desta classe de bug.**
- **S4 — Bloqueio de rede específico do mobile.** Mixed content (página HTTPS chamando API HTTP — bloqueado sem alarde), CORS que só falha no domínio/origem usado pelo celular, API acessível só na rede interna (funciona no wifi corporativo do PC, falha no 4G). *Verificar:* qual URL exata o celular chama? Abra-a no navegador do próprio celular.
- **S5 — Regra de segurança negando a escrita.** Firestore rules / RLS do Supabase rejeitando porque a sessão do celular está anônima ou expirada — e o app engolindo a rejeição (volta ao S3). *Verificar:* logs do backend; teste a mesma escrita autenticado igual ao PC.
- **S6 — Formulário/evento desconectado no layout mobile.** Layout responsivo com formulário duplicado onde só a versão desktop tem handler; botão fora do `<form>`; evento que não dispara no touch. *Verificar:* o handler chega a executar no celular? (instrumentação da Etapa 3 responde).

**Lado da leitura (registro está no banco, PC não mostra):**

- **S7 — Identidade diferente por dispositivo.** Auth anônima ou sessões distintas: o dado existe, mas pertence a "outro usuário". *Verificar:* compare o `user_id` do registro gravado com o `user_id` da sessão do PC. Suspeito nº 1 do lado da leitura.
- **S8 — Filtro de data/timezone.** Gravado 23h30 no horário do aparelho → armazenado como dia seguinte em UTC → o filtro "hoje" do PC não o alcança. *Verificar:* o timestamp bruto no banco × o filtro aplicado na consulta.
- **S9 — Cache ou consulta na leitura.** PC exibindo lista cacheada (service worker cacheando o GET da API), paginação/ordenação escondendo o registro. *Verificar:* hard refresh no PC; consulta direta ao endpoint.

Se um suspeito for CONFIRMADO com evidência, pule para a Etapa 4. Se todos forem descartados ou restarem "não testáveis", instrumente.

## Etapa 3 — Instrumentação (quando o checklist não fecha o caso)

O celular não tem DevTools à mão — dê olhos ao app:

1. **Console visível no aparelho**: injete [vConsole](https://github.com/Tencent/vConsole) ou eruda via CDN (uma linha), ou, em app de arquivo único, um painel de log fixo no rodapé com um helper `log()`. Ative-o atrás de `?debug=1` para não poluir o uso normal.
2. **Rastreador da cadeia**: registre com timestamp cada elo do caminho de gravação — `handler disparou` → `validação ok` → `enviando request para <URL>` → `resposta <status>` → `confirmado`. **A última linha que aparecer no log é o elo onde o dado morreu.** Esse é o resultado do diagnóstico.
3. **Capture o invisível**: `window.onerror` e `window.addEventListener('unhandledrejection', ...)` despejando no painel — é aqui que os erros engolidos do S3 aparecem.
4. **Lado servidor**: logue toda request de escrita que chegar (timestamp + payload). Cruzar "celular diz que enviou" × "servidor diz que recebeu" fecha a questão de rede.
5. **Depuração remota** (opcional, se o usuário tiver o hardware): Android via `chrome://inspect` + USB; iPhone via Safari/Mac.

Reproduza **uma vez** no celular físico com o rastreador ligado e leia o log. Uma reprodução instrumentada vale mais que dez releituras do código.

## Etapa 4 — Correção e prova real

- Corrija **apenas o elo confirmado**, com a menor mudança possível. Uma mudança por vez: se empilhar três correções e funcionar, você não sabe qual agiu; se quebrar, não sabe qual quebrou.
- **Prova de ponta a ponta obrigatória**: cadastrar no **celular físico** → confirmar **direto no banco** → confirmar **na tela do PC**. O modo responsivo do DevTools do desktop **não vale como prova** — ele não reproduz service worker, rede móvel, teclado virtual nem o ciclo de vida agressivo de abas do mobile.
- **Mini-regressão** (os cenários que mais derrubam gravação mobile): salvar e fechar o app imediatamente; salvar no 4G (fora do wifi); salvar após a tela bloquear e desbloquear.
- Remova a instrumentação ou deixe-a permanente atrás de `?debug=1` — recomende manter: o próximo bug agradece.
- **Blindagem mínima pós-correção**: toda gravação deve ter feedback honesto na UI — "salvando… → salvo ✓" só após confirmação do servidor, e mensagem de erro visível quando falhar. App que mente sucesso gera exatamente o bug que este protocolo caça.

## Etapa 5 — Registro do diagnóstico

Gere/atualize um **`DIAGNOSTICO.md`** no projeto, com histórico datado (mesma lógica do `AUDITORIA.md` da skill mapeador-de-processos — se o projeto tiver auditoria, referencie o diagnóstico lá):

```
# Diagnóstico — [sistema] — [data]
## Sintoma relatado
## Cadeia de persistência do sistema (elo a elo)
## Teste divisor (Etapa 1): resultado + evidência
## Suspeitos verificados (tabela: suspeito | veredito | evidência)
## Causa raiz (com evidência concreta)
## Correção aplicada (o que mudou e por quê)
## Prova real (celular → banco → PC, com data/hora)
## Riscos residuais e pendências
```

O registro evita o pior cenário: o mesmo bug voltar em três meses e o diagnóstico recomeçar do zero.

---

## Antipadrões — evite

- **Correção às cegas**: "tenta adicionar um await" sem evidência do elo quebrado. É o motivo de as tentativas anteriores terem falhado.
- **Pular a Etapa 1**: instrumentar tudo antes do teste de 2 minutos que divide o problema ao meio.
- **Consultar o banco com filtro**: buscar "os registros do usuário X de hoje" esconde exatamente os casos S7 e S8. Busque pelo conteúdo único, sem filtros.
- **Aceitar "não dá erro" como resposta**: silêncio é sintoma, não ausência de problema.
- **Testar no modo responsivo do desktop** e declarar resolvido.
- **Confiar na tela**: "apareceu na lista, então salvou" — escrita local otimista mente.
- **Band-aid no sintoma**: botão "sincronizar manualmente" em vez de causa raiz.
- **Reescrever o módulo inteiro "para resolver de vez"**: destrói a cena do crime e importa bugs novos.
- **Empilhar correções**: uma mudança por vez, com prova entre elas.
