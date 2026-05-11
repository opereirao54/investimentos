# Guia de Implementação Rápida - Appliquei SaaS

## ✅ Checklist de Configuração (15 minutos)

### 1. Firebase Setup (5 min)

```bash
# Acesse https://console.firebase.google.com
# 1. Criar novo projeto "appliquei-saas"
# 2. Authentication → Get Started → Email/Password → Enable
# 3. Firestore Database → Create Database → Start in test mode
# 4. Project Settings → Service Accounts → Generate New Private Key
#    → Guardar JSON em local seguro
```

**Variáveis de ambiente (.env.local):**
```env
# Extrair do JSON da service account
FIREBASE_PROJECT_ID=appliquei-saas-xxxxx
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@appliquei-saas-xxxxx.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"

# Extrair de Project Settings → General → Your apps → SDK Setup
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=appliquei-saas-xxxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=appliquei-saas-xxxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=appliquei-saas-xxxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
```

### 2. Asaas Setup (5 min)

```bash
# Acesse https://sandbox.asaas.com (testes) ou https://asaas.com (produção)
# 1. Criar conta
# 2. Configurações → Webhooks
#    URL: https://seu-app.vercel.app/api/webhook/asaas
#    Eventos: PAYMENT_CONFIRMED, PAYMENT_CREATED
# 3. Copiar Webhook Token
# 4. Cobranças → Links de Pagamento → Criar
#    - Valor: R$ 50,00 (exemplo)
#    - Recorrência: Mensal
#    - externalReference: user_{uid} (será substituído dinamicamente)
```

**Variáveis de ambiente:**
```env
ASAAS_WEBHOOK_TOKEN=seu-token-aqui
ASAAS_API_KEY=$aact_...
JWT_SECRET=$(openssl rand -base64 32)
```

### 3. Firestore Rules (2 min)

No Firebase Console → Firestore Database → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;
    }
  }
}
```

### 4. Instalar e Rodar (3 min)

```bash
cd appliquei-saas

# Instalar dependências
npm install

# Copiar e configurar .env
cp .env.example .env.local
# Editar .env.local com suas chaves

# Rodar em desenvolvimento
npm run dev

# Acessar http://localhost:3000
```

### 5. Deploy na Vercel (bonus)

```bash
# Instalar CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Seguir prompts:
# - Set up and deploy? Y
# - Which scope? (seu email)
# - Link to existing project? N
# - Directory? ./applaquei-saas
# - Want to override settings? N

# Configurar variáveis no painel da Vercel:
# Project Settings → Environment Variables
# Adicionar todas as variáveis do .env.local
```

## 🧪 Testes Manuais

### Teste 1: Registro
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nome":"Test User","email":"teste@test.com","password":"123456"}'
```

### Teste 2: Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@test.com","password":"123456"}' \
  -c cookies.txt
```

### Teste 3: Dashboard (protegido)
```bash
curl -b cookies.txt http://localhost:3000/dashboard
```

### Teste 4: Webhook Asaas (simulação)
```bash
# Payload de exemplo para PAYMENT_CONFIRMED
curl -X POST http://localhost:3000/api/webhook/asaas \
  -H "Content-Type: application/json" \
  -H "X-Signature: $(echo -n '{"event":"PAYMENT_CONFIRMED","data":{"externalReference":"user_abc123","value":50.00}}' | openssl dgst -sha256 -hmac 'SEU_WEBHOOK_TOKEN' | cut -d' ' -f2)" \
  -d '{"event":"PAYMENT_CONFIRMED","data":{"externalReference":"user_abc123","value":50.00,"status":"CONFIRMED"}}'
```

## 📊 Estrutura do Banco de Dados

### Coleção: `users`
```typescript
{
  uid: "abc123xyz",           // Firebase Auth UID
  email: "user@email.com",
  nome: "Nome do Usuário",
  plano: "gratis",            // ou "pago"
  cupomReferral: "ABC12345",  // Código único (8 chars)
  indicadoPor: "xyz789abc",   // UID de quem indicou (ou null)
  applicashBalance: 0,        // Saldo em reais
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z"
}
```

## 🔐 Fluxo de Segurança

1. **Middleware** verifica cookie JWT em `/dashboard`
2. **Server Component** valida sessão no servidor
3. **Firestore** checa plano do usuário
4. Se `plano === 'gratis'` → mostra tela de upgrade
5. Se `plano === 'pago'` → injeta HTML legado intacto

## 💰 Fluxo de Pagamento + Indicação

1. Usuário A se registra → ganha cupom `AAAA1111`
2. Usuário B se registra com cupom `AAAA1111` → campo `indicadoPor: uid_A`
3. Usuário B paga R$ 50,00 no Asaas
4. Webhook `PAYMENT_CONFIRMED` chega
5. Sistema atualiza:
   - Usuário B: `plano = 'pago'`
   - Usuário A: `applicashBalance += 5.00` (10% de R$ 50)

## 🚨 Troubleshooting Comum

### Erro: "Firebase Admin: Variáveis ausentes"
→ Verifique se `FIREBASE_PRIVATE_KEY` tem as quebras de linha (`\n`)

### Erro: "Assinatura inválida" no webhook
→ Use o token exato do painel do Asaas (não a API key)

### HTML legado não carrega
→ Copie `Appliquei_v13.0.html` para dentro da pasta `applaquei-saas/`

### Cookie não persiste
→ Em localhost, HTTP é OK. Em produção, precisa de HTTPS

---

**Próximos passos após setup:**
1. Teste registro e login
2. Simule pagamento no Asaas Sandbox
3. Verifique se plano muda para 'pago' no Firestore
4. Teste sistema de indicações
5. Faça deploy na Vercel
