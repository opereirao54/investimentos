import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

/**
 * POST /api/webhook/asaas
 * 
 * Webhook para receber notificações de pagamento do Asaas.
 * Escuta o evento PAYMENT_CONFIRMED e:
 * 1. Atualiza o plano do utilizador pagador para 'pago'
 * 2. Se o utilizador tem um indicador, credita 10% do valor no applicashBalance do indicador
 * 
 * Eventos suportados:
 * - PAYMENT_CONFIRMED: Pagamento confirmado
 * - PAYMENT_DELETED: Pagamento removido/estornado (opcional, para reverter)
 */
export async function POST(request: NextRequest) {
  try {
    // Verificar assinatura do webhook (em produção, validar signature header)
    const signature = request.headers.get('X-Signature');
    const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;
    
    // NOTA: Em produção, implementar validação criptográfica da assinatura
    // if (signature !== webhookSecret) {
    //   return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
    // }

    const body = await request.json();
    const event = body.event;
    const payment = body.payment || body.data;

    console.log('[ASAAS WEBHOOK] Evento recebido:', event);

    // Apenas processar pagamentos confirmados
    if (event !== 'PAYMENT_CONFIRMED') {
      return NextResponse.json({ received: true, event });
    }

    // Extrair dados do pagamento
    const paymentId = payment.id;
    const customerEmail = payment.customer?.email || payment.email;
    const value = payment.value || payment.amount;
    const status = payment.status;

    if (!customerEmail) {
      console.error('[ASAAS WEBHOOK] Email do cliente não encontrado');
      return NextResponse.json(
        { error: 'Email do cliente não encontrado' },
        { status: 400 }
      );
    }

    if (status !== 'CONFIRMED') {
      console.log('[ASAAS WEBHOOK] Pagamento não está confirmado, ignorando');
      return NextResponse.json({ received: true, status });
    }

    // Encontrar utilizador pelo email
    const usersRef = db.collection('users');
    const userSnapshot = await usersRef.where('email', '==', customerEmail).limit(1).get();

    if (userSnapshot.empty) {
      console.error('[ASAAS WEBHOOK] Utilizador não encontrado:', customerEmail);
      return NextResponse.json(
        { error: 'Utilizador não encontrado' },
        { status: 404 }
      );
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log('[ASAAS WEBHOOK] Utilizador encontrado:', userId, userData.email);

    // Atualizar plano para 'pago'
    await updateDoc(doc(db, 'users', userId), {
      plano: 'pago',
      lastPaymentDate: new Date().toISOString(),
      lastPaymentValue: value,
      asaasPaymentId: paymentId,
      updatedAt: new Date().toISOString(),
    });

    console.log('[ASAAS WEBHOOK] Plano atualizado para "pago"');

    // === REGRA APPLICASH ===
    // Verificar se este utilizador tem um indicador
    if (userData.referredBy) {
      const referrerId = userData.referredBy;
      const referrerRef = doc(db, 'users', referrerId);
      const referrerDoc = await getDoc(referrerRef);

      if (referrerDoc.exists()) {
        const referrerData = referrerDoc.data();
        
        // Calcular 10% do valor do pagamento
        const commissionRate = 0.10; // 10%
        const commissionAmount = typeof value === 'number' ? value * commissionRate : 0;

        console.log(
          '[ASAAS WEBHOOK] Crédito Applicash:',
          `Indicador: ${referrerId}, Valor: ${commissionAmount} (10% de ${value})`
        );

        // Creditar 10% no applicashBalance do indicador
        await updateDoc(referrerRef, {
          applicashBalance: increment(commissionAmount),
          totalApplicashEarned: increment(commissionAmount),
          updatedAt: new Date().toISOString(),
        });

        // Opcional: Registrar transação no histórico do Applicash
        const transactionsRef = db.collection('applicashTransactions');
        await transactionsRef.add({
          referrerId,
          referredUserId: userId,
          amount: commissionAmount,
          paymentId,
          paymentValue: value,
          type: 'referral_commission',
          description: `Comissão de 10% sobre pagamento de ${userData.email}`,
          createdAt: new Date().toISOString(),
        });

        console.log('[ASAAS WEBHOOK] Comissão creditada com sucesso');
      } else {
        console.warn('[ASAAS WEBHOOK] Indicador não encontrado:', referrerId);
      }
    } else {
      console.log('[ASAAS WEBHOOK] Utilizador sem indicador, sem comissão a creditar');
    }

    return NextResponse.json({
      success: true,
      message: 'Pagamento processado com sucesso',
      userId,
      commissionProcessed: !!userData.referredBy,
    });

  } catch (error: any) {
    console.error('[ASAAS WEBHOOK] Erro ao processar webhook:', error);
    
    return NextResponse.json(
      { error: 'Erro interno ao processar webhook', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/webhook/asaas
 * 
 * Endpoint para teste de conectividade do Asaas
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Webhook Asaas ativo',
    timestamp: new Date().toISOString(),
  });
}
