import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminFirestore } from '@/lib/firebase/admin';
import { createSessionCookie } from '@/lib/session';

// Gera um código de referral único (8 caracteres alfanuméricos)
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function POST(request: Request) {
  try {
    const { email, password, nome, cupomReferral } = await request.json();

    if (!email || !password || !nome) {
      return NextResponse.json(
        { error: 'Email, senha e nome são obrigatórios' },
        { status: 400 }
      );
    }

    // Valida formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Formato de email inválido' },
        { status: 400 }
      );
    }

    // Valida força da senha (mínimo 6 caracteres)
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      );
    }

    // Cria usuário no Firebase Auth
    const auth = getAuth();
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: nome,
    });

    // Verifica se o cupom de referral é válido (se fornecido)
    let indicadoPor: string | null = null;
    if (cupomReferral && cupomReferral.trim() !== '') {
      const normalizedCupom = cupomReferral.trim().toUpperCase();
      
      // Busca usuário com este cupom
      const usersSnapshot = await adminFirestore
        .collection('users')
        .where('cupomReferral', '==', normalizedCupom)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        const indicadorDoc = usersSnapshot.docs[0];
        // Não pode usar o próprio cupom
        if (indicadorDoc.id !== userRecord.uid) {
          indicadoPor = indicadorDoc.id;
        }
      }
    }

    // Cria documento do usuário no Firestore
    const userData = {
      uid: userRecord.uid,
      email,
      nome,
      plano: 'gratis' as const,
      cupomReferral: generateReferralCode(),
      indicadoPor: indicadoPor || null,
      applicashBalance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await adminFirestore.collection('users').doc(userRecord.uid).set(userData);

    // Obtém token ID para criar sessão
    // Nota: Precisamos fazer login temporário para obter o token
    // Em produção, isso pode ser otimizado com Firebase Admin SDK custom token
    const idToken = await userRecord.getIdToken();
    
    // Como não temos a senha em claro aqui, usamos uma abordagem alternativa:
    // Criamos um custom token com Firebase Admin
    const customToken = await auth.createCustomToken(userRecord.uid);
    
    // Para simplificar, vamos apenas retornar os dados sem cookie
    // O usuário precisará fazer login após o registro
    // OU: criamos a sessão diretamente usando o custom token
    
    // Abordagem simplificada: retorna sucesso sem cookie, usuário faz login
    return NextResponse.json({
      success: true,
      message: 'Conta criada com sucesso! Faça login para continuar.',
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        nome: userRecord.displayName,
        cupomReferral: userData.cupomReferral,
      },
    }, { status: 201 });

  } catch (error: any) {
    console.error('Erro no registro:', error);
    
    // Traduz erros do Firebase
    let errorMessage = 'Erro ao criar conta';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'Este email já está cadastrado';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Email inválido';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Senha muito fraca';
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 400 }
    );
  }
}
