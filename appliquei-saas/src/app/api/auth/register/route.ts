import { NextRequest, NextResponse } from 'next/server';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';

/**
 * POST /api/auth/register
 * 
 * Regista um novo utilizador com Email/Senha no Firebase Auth.
 * Cria documento no Firestore com:
 * - status: 'gratis' (plano gratuito)
 * - applicashBalance: 0
 * - couponCode: cupão único gerado (APP-{uid.substring(0,6)})
 * - referredBy: ID do indicador (se cupão de indicação foi fornecido e válido)
 * 
 * Body esperado:
 * {
 *   email: string,
 *   password: string,
 *   displayName?: string,
 *   referralCoupon?: string (opcional)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, displayName, referralCoupon } = body;

    // Validação básica
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Formato de email inválido' },
        { status: 400 }
      );
    }

    // Validar senha (mínimo 6 caracteres)
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      );
    }

    // Verificar se existe um cupão de indicação e obter o ID do indicador
    let referredBy: string | null = null;
    if (referralCoupon && typeof referralCoupon === 'string') {
      const trimmedCoupon = referralCoupon.trim().toUpperCase();
      
      // Procurar utilizador com este cupão
      const couponPattern = /^APP-[A-Z0-9]{6}$/;
      if (!couponPattern.test(trimmedCoupon)) {
        return NextResponse.json(
          { error: 'Formato de cupão de indicação inválido. Deve ser APP-XXXXXX' },
          { status: 400 }
        );
      }

      // Query para encontrar o utilizador pelo cupão
      // Nota: Em produção, criar um índice em Firestore para couponCode
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('couponCode', '==', trimmedCoupon).limit(1).get();

      if (!snapshot.empty) {
        const referrerDoc = snapshot.docs[0];
        const referrerData = referrerDoc.data();
        
        // Não permitir auto-referência (verificação adicional será feita após criar o user)
        referredBy = referrerDoc.id;
      } else {
        // Cupão não encontrado - retornar erro ou ignorar?
        // Vamos retornar erro para evitar registos com cupões inválidos
        return NextResponse.json(
          { error: 'Cupão de indicação não encontrado' },
          { status: 400 }
        );
      }
    }

    // Criar utilizador no Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Gerar cupão único para este utilizador
    const couponCode = `APP-${user.uid.substring(0, 6).toUpperCase()}`;

    // Atualizar perfil do utilizador (displayName opcional)
    if (displayName) {
      await updateProfile(user, { displayName });
    }

    // Criar documento no Firestore
    const userData = {
      email: user.email,
      displayName: displayName || null,
      plano: 'gratis', // Plano padrão: gratuito
      applicashBalance: 0, // Saldo inicial do Applicash
      couponCode, // Cupão único deste utilizador
      referredBy: referredBy || null, // ID do indicador (se aplicável)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    await setDoc(doc(db, 'users', user.uid), userData);

    // Se tem indicador, atualizar o contador de indicações do indicador
    if (referredBy) {
      const referrerRef = doc(db, 'users', referredBy);
      const referrerDoc = await getDoc(referrerRef);
      
      if (referrerDoc.exists()) {
        const referrerData = referrerDoc.data();
        const currentReferrals = referrerData.referralCount || 0;
        
        // Atualizar contador de indicações
        await setDoc(referrerRef, {
          referralCount: currentReferrals + 1,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
    }

    // Retornar sucesso (sem expor dados sensíveis)
    return NextResponse.json({
      success: true,
      message: 'Utilizador criado com sucesso',
      userId: user.uid,
      couponCode,
      email: user.email,
    }, { status: 201 });

  } catch (error: any) {
    console.error('Erro no registo:', error);

    // Tratar erros específicos do Firebase Auth
    if (error.code === 'auth/email-already-in-use') {
      return NextResponse.json(
        { error: 'Este email já está registado' },
        { status: 409 }
      );
    }

    if (error.code === 'auth/invalid-email') {
      return NextResponse.json(
        { error: 'Email inválido' },
        { status: 400 }
      );
    }

    if (error.code === 'auth/weak-password') {
      return NextResponse.json(
        { error: 'Senha muito fraca' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Erro interno ao criar conta. Tente novamente.' },
      { status: 500 }
    );
  }
}
