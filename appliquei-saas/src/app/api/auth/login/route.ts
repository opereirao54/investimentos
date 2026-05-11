import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminFirestore } from '@/lib/firebase/admin';
import { createSessionCookie } from '@/lib/session';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    // Autentica com Firebase Auth
    const auth = getAuth();
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    const user = userCredential.user;

    // Obtém o token ID do Firebase
    const idToken = await user.getIdToken();

    // Cria o cookie de sessão
    const sessionCookie = await createSessionCookie(idToken);

    // Verifica o plano do usuário no Firestore
    const userDoc = await adminFirestore.collection('users').doc(user.uid).get();
    const userData = userDoc.data();
    const plano = userData?.plano || 'gratis';

    // Prepara a resposta com cookie HTTP-only
    const response = NextResponse.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        plano,
      },
    });

    response.cookies.set({
      name: 'session',
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 dias
      path: '/',
    });

    return response;
  } catch (error: any) {
    console.error('Erro no login:', error);
    
    // Traduz erros do Firebase
    let errorMessage = 'Erro ao fazer login';
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'Usuário não encontrado';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Senha incorreta';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Email inválido';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Muitas tentativas. Tente novamente mais tarde.';
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 401 }
    );
  }
}
