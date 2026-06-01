# Firebase App Check

App Check anexa um **token de atestação** a cada chamada dos serviços Firebase
(Auth, Firestore) feita pelo app. Com o _enforcement_ ligado no console, o
Firebase rejeita qualquer chamada sem token válido — ou seja, requests que não
venham do app real (scripts batendo direto na apiKey pública) são bloqueadas.

## O que o App Check resolve (e o que não resolve)

- **Resolve:** abuso/custo via apiKey pública — criação de contas em massa no
  Auth, varredura/consumo de quota no Firestore por clientes que não são o app.
- **NÃO substitui** as Security Rules. Os dados continuam protegidos por uid
  pelas regras em `firestore.rules` (isolamento por `request.auth.uid`). App
  Check é uma camada adicional (anti-abuso), não o controle de acesso a dados.
- **NÃO afeta o backend.** As Vercel Functions usam o Admin SDK, que é
  privilegiado e ignora o App Check. A verificação de identidade no backend
  continua via ID token do Firebase Auth.

## Como está implementado no código

O app usa o **SDK compat** do Firebase (scripts `firebase-*-compat.js` no
`<head>` do HTML), não o modular. O App Check segue o mesmo padrão:

- `Appliquei_v13.0.html` carrega `firebase-app-check-compat.js` (logo após
  `firebase-firestore-compat.js`).
- `web/appliquei-firebase-init.js` ativa o App Check com
  `firebase.appCheck().activate(new firebase.appCheck.ReCaptchaV3Provider(siteKey), true)`
  **logo após** `firebase.initializeApp(cfg)` e **antes** de `firebase.auth()` /
  `firebase.firestore()`, para os tokens acompanharem as primeiras chamadas.
  O `true` final liga o auto-refresh do token. Idempotente (flag
  `AppliqueiFirebase.appCheckActivated`).
- A ativação é **gated** na presença de `window.__APPLIQUEI_APPCHECK_SITE_KEY__`
  (site key pública do reCAPTCHA v3) **e** do script compat. Enquanto a key
  estiver vazia, o App Check **não ativa** — o app funciona normalmente. Isso
  permite fazer o deploy do código antes de ligar o enforcement (rollout seguro).
- A site key é definida em `web/firebase-config.appliquei-prod.js`
  (produção) e `web/firebase-config.example.js` (vazia, dev/local).

## Passos de ativação (rollout sem quebrar usuários)

> Faça nesta ordem. Não ligue o enforcement antes de confirmar que os tokens
> estão chegando (passo 4), senão você bloqueia os usuários reais.

1. **Criar o provider reCAPTCHA v3**
   - Firebase Console → **App Check** → aba **Apps** → selecione o app **Web**.
   - Escolha **reCAPTCHA v3** como provider. O console gera (ou pede) uma
     **site key** pública. Guarde-a.
   - (O reCAPTCHA v3 não tem widget visível; roda em background.)

2. **Publicar a site key no app**
   - Cole a site key em `web/firebase-config.appliquei-prod.js`:
     ```js
     window.__APPLIQUEI_APPCHECK_SITE_KEY__ = 'SUA_SITE_KEY_RECAPTCHA_V3';
     ```
   - Commit + deploy. A partir daqui o app passa a **enviar** tokens de App
     Check, mas o enforcement ainda está **desligado** — nada é bloqueado.

3. **Registrar a origem de dev (opcional, para testar local)**
   - No bootstrap, antes do módulo `appliquei-firebase-init.js`, defina:
     ```html
     <script>
       window.__APPLIQUEI_APPCHECK_DEBUG__ = true;
     </script>
     ```
   - Rode o app local: o console do navegador imprime um **debug token**.
   - Firebase Console → App Check → app Web → menu ⋮ → **Manage debug tokens**
     → cole o token. (Não comite `__APPLIQUEI_APPCHECK_DEBUG__ = true` em prod.)

4. **Verificar adoção (métricas)**
   - Firebase Console → App Check → aba **APIs** (Firestore, Authentication).
   - Aguarde os gráficos mostrarem a maioria das requests como **verificadas**
     (com token válido). Recomenda-se observar por **alguns dias** para cobrir
     usuários com cache antigo do app.

5. **Ligar o enforcement**
   - Quando a fração de requests verificadas estiver alta, clique em
     **Enforce** para **Cloud Firestore** e depois para **Authentication**.
   - A partir daí, requests sem token válido são rejeitadas.

## Rollback

- **Desligar enforcement:** Firebase Console → App Check → API → **Unenforce**.
- **Desligar o App Check no client:** esvazie `__APPLIQUEI_APPCHECK_SITE_KEY__`
  e faça deploy — o init volta a pular a inicialização.

## Referências

- Security Rules atuais: [`../firestore.rules`](../firestore.rules)
- Auditoria de exposição: [`../AUDITORIA.md`](../AUDITORIA.md)
