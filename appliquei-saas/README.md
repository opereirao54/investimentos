# Appliquei SaaS - Portal de Segurança (Gatekeeper)

Solução 100% baseada em serviços gratuitos (Free Tiers) para proteger e monetizar o **Appliquei v13.0**.

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js (Vercel Hobby)                   │
│                     "Portaria de Segurança"                  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  /login     │  │  /register   │  │  /dashboard     │   │
│  │  (público)  │  │  (público)   │  │  (protegido)    │   │
│  └─────────────┘  └──────────────┘  └────────┬────────┘   │
│                                              │              │
│                                    ┌─────────▼─────────┐   │
│                                    │ plano === 'gratis'│   │
│                                    │ → Tela de Upgrade │   │
│                                    └───────────────────┘   │
│                                              │              │
│                                    ┌─────────▼─────────┐   │
│                                    │ plano === 'pago'  │   │
│                                    │ → HTML Legado     │   │
│                                    │   INTACTO         │   │
│                                    └───────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Firebase Auth │  │   Firestore   │  │  Asaas API    │
│  (Spark Plan) │  │  (Spark Plan) │  │  (Webhook)    │
└───────────────┘  └───────────────┘  └───────────────┘
```

## 📁 Estrutura do Projeto

```
applaquei-saas/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts       # Login com cookie JWT
│   │   │   │   └── register/route.ts    # Registro + cupom referral
│   │   │   ├── webhook/
│   │   │   │   └── asaas/route.ts       # Webhook de pagamentos
│   │   │   └── health/route.ts          # Health check
│   │   ├── dashboard/
│   │   │   ├── page.tsx                 # Server Component principal
│   │   │   └── LegacyAppViewer.tsx      # Injeta HTML legado intacto
│   │   ├── login/page.tsx               # Tela de login
│   │   ├── register/page.tsx            # Tela de registro
│   │   ├── globals.css                  # Estilos globais
│   │   └── layout.tsx                   # Root layout
│   ├── lib/
│   │   ├── firebase/
│   │   │   ├── admin.ts                 # Firebase Admin SDK
│   │   │   └── client.ts                # Firebase Client SDK
│   │   └── session.ts                   # Gestão de cookies JWT
│   └── middleware.ts                    # Proteção de rotas
├── public/                              # Assets estáticos
├── package.json
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── .env.example                         # Variáveis de ambiente
```

## 🔐 Segurança Implementada

### 1. Middleware de Proteção (`src/middleware.ts`)
- Intercepta todas as requisições para `/dashboard`
- Verifica cookie de sessão JWT válido
- Redireciona para `/login` se não autenticado
- Cookies HTTP-only, secure e sameSite=lax

### 2. Firebase Admin SDK (`src/lib/firebase/admin.ts`)
- Validação de sessão no servidor (NUNCA no cliente)
- Certificados carregados via variáveis de ambiente
- Singleton para evitar re-inicialização

### 3. Webhook Asaas com HMAC (`src/app/api/webhook/asaas/route.ts`)
- Validação de assinatura HMAC-SHA256
- Timing-safe comparison para prevenir ataques
- Atualização automática do plano para 'pago'
- Crédito automático de 10% Applicash para indicadores

## 💰 Fluxo de Pagamento

1. Usuário grátis acessa `/dashboard` → vê tela de upgrade
2. Clica em "Assinar Plano Premium" → link do Asaas com `externalReference=user_{uid}`
3. Paga no Asaas → Asaas envia webhook `PAYMENT_CONFIRMED`
4. Webhook valida assinatura HMAC → atualiza `plano: 'pago'` no Firestore
5. Se tiver `indicadoPor`, credita 10% no `applicashBalance` do indicador
6. Usuário recarrega `/dashboard` → HTML legado é injetado intacto

## 🎯 Sistema de Indicações (Applicash)

### No Registro:
```typescript
{
  uid: "abc123",
  email: "user@email.com",
  plano: "gratis",
  cupomReferral: "ABC12345",      // Gerado automaticamente
  indicadoPor: "xyz789",          // Se usou cupom de alguém
  applicashBalance: 0,
}
```

### No Pagamento (Webhook):
- Valor: R$ 50,00
- Comissão: 10% = R$ 5,00
- Credita no `applicashBalance` do usuário `indicadoPor`

## 🚀 Como Configurar

### 1. Firebase (Grátis - Spark Plan)

1. Crie projeto em https://console.firebase.google.com
2. Ative **Authentication** (Email/Senha)
3. Crie banco **Firestore Database**
4. Vá em **Project Settings** → **Service Accounts**
5. Gere nova chave privada (JSON)
6. Extraia os dados para `.env`:

```env
FIREBASE_PROJECT_ID=seu-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@seu-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 2. Firebase Client SDK

No Firebase Console → Project Settings → General → Your apps:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=seu-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=seu-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=seu-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
```

### 3. Asaas (Sandbox ou Produção)

1. Crie conta em https://asaas.com
2. Vá em **Configurações** → **Webhooks**
3. Defina URL: `https://seu-app.vercel.app/api/webhook/asaas`
4. Copie o **Token de Webhook**
5. Crie um **Link de Pagamento** recorrente

```env
ASAAS_WEBHOOK_TOKEN=seu-webhook-token
ASAAS_API_KEY=$aact_...

# No link de pagamento do Asaas, use:
# externalReference: user_{uid}
```

### 4. JWT Secret

Gere uma string aleatória segura (mínimo 32 caracteres):

```bash
openssl rand -base64 32
```

```env
JWT_SECRET=sua-string-secreta-aleatoria-aqui
```

### 5. Instalar e Rodar

```bash
cd appliquei-saas
npm install

# Copie .env.example para .env.local e preencha
cp .env.example .env.local

# Desenvolvimento
npm run dev

# Build para produção
npm run build
npm start
```

### 6. Deploy na Vercel (Hobby - Grátis)

```bash
# Instale a CLI da Vercel
npm i -g vercel

# Deploy
vercel

# Configure as variáveis de ambiente no painel da Vercel
```

## 🛡️ Regras de Segurança do Firestore

Configure no Firebase Console → Firestore Database → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Usuários só podem ler seus próprios dados
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // Apenas server-side via Admin SDK
    }
  }
}
```

## 📊 Modelo de Dados (Firestore)

```typescript
interface UserDocument {
  uid: string;              // ID do Firebase Auth
  email: string;            // Email do usuário
  nome: string;             // Nome completo
  plano: 'gratis' | 'pago'; // Plano atual
  cupomReferral: string;    // Código único de indicação (8 chars)
  indicadoPor: string | null; // UID de quem indicou
  applicashBalance: number; // Saldo em reais (ex: 15.50)
  applicashHistory?: Array<{
    type: 'referral_commission';
    amount: number;
    fromUser: string;
    date: string;
    description: string;
  }>;
  lastPaymentAt?: string;   // ISO date do último pagamento
  lastPaymentValue?: number; // Valor do último pagamento
  createdAt: string;        // ISO date de criação
  updatedAt: string;        // ISO date de atualização
}
```

## ⚠️ Importante: HTML Legado Intocável

O arquivo `Appliquei_v13.0.html` **NÃO** é modificado. Ele é:
- Lido diretamente do sistema de arquivos
- Injetado como HTML raw no componente `LegacyAppViewer.tsx`
- Recebe apenas um script mínimo de autenticação (`window.AppliqueiAuth`)
- Mantém 100% do código, layout, cores e lógica originais

## 🔧 Troubleshooting

### Erro: "Firebase Admin: Variáveis de ambiente ausentes"
- Verifique se `.env.local` existe e está preenchido
- No production (Vercel), configure no painel Environment Variables

### Erro: "Assinatura inválida" no webhook
- Verifique se `ASAAS_WEBHOOK_TOKEN` está correto
- Teste no sandbox primeiro
- O token deve ser exatamente o do painel do Asaas

### HTML legado não carrega
- Verifique o caminho em `LegacyAppViewer.tsx`: `join(process.cwd(), '../../Appliquei_v13.0.html')`
- O arquivo deve estar na raiz do workspace

## 📝 Licença

MIT License - Projeto interno Appliquei SaaS

---

**Desenvolvido com ❤️ usando apenas Free Tiers:**
- Next.js → Vercel Hobby (Grátis)
- Autenticação → Firebase Spark (Grátis)
- Banco de Dados → Firestore Spark (Grátis)
- Pagamentos → Asaas (taxa por transação)
