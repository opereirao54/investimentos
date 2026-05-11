# Firebase Admin SDK - Configuração para Validação de Sessão no Servidor
# Este módulo é usado APENAS no servidor (Server Components e API Routes)

import admin from 'firebase-admin';

// Verifica se o Firebase Admin já foi inicializado (evita erro em hot-reload)
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  
  if (!privateKey || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error(
      'Firebase Admin: Variáveis de ambiente ausentes. Configure FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID e FIREBASE_CLIENT_EMAIL'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

const adminApp = admin.app();
const adminAuth = adminApp.auth();
const adminFirestore = adminApp.firestore();

export { adminApp, adminAuth, adminFirestore };
