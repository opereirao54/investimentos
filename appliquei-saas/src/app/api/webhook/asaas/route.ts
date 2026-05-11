import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';

// Interface para os dados do webhook Asaas
interface AsaasWebhookEvent {
  event: string;
  data: {
    id?: string;
    customer?: string;
    value?: number;
    status?: string;
    externalReference?: string;
    [key: string]: any;
  };
}

/**
 * Valida o token HMAC do webhook Asaas
 * O Asaas envia um header "X-Signature" com a assinatura HMAC-SHA256
 */
function validateAsaasSignature(payload: string, signature: string): boolean {
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  
  if (!webhookToken) {
    console.error('ASAAS_WEBHOOK_TOKEN não configurado');
    return false;
  }

  // Calcula o HMAC-SHA256 do payload
  const calculatedSignature = crypto
    .createHmac('sha256', webhookToken)
    .update(payload)
    .digest('hex');

  // Compara as assinaturas (usando timing-safe comparison)
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(calculatedSignature, 'hex')
  );
}

/**
 * Processa pagamento confirmado
 * Atualiza plano do usuário para 'pago' e credita Applicash se houver indicação
 */
async function handlePaymentConfirmed(eventData: any) {
  const { adminFirestore } = await import('@/lib/firebase/admin');
  
  const externalReference = eventData.externalReference;
  const paymentValue = eventData.value || 0;
  
  if (!externalReference) {
    console.error('Pagamento sem externalReference');
    return;
  }

  // externalReference deve conter o UID do usuário
  // Formato esperado: "user_{uid}" ou apenas o uid
  const userId = externalReference.replace('user_', '');
  
  // Busca o usuário no Firestore
  const userDocRef = adminFirestore.collection('users').doc(userId);
  const userDoc = await userDocRef.get();
  
  if (!userDoc.exists) {
    console.error(`Usuário ${userId} não encontrado`);
    return;
  }

  const userData = userDoc.data()!;
  
  // Atualiza plano para 'pago'
  await userDocRef.update({
    plano: 'pago',
    updatedAt: new Date().toISOString(),
    lastPaymentAt: new Date().toISOString(),
    lastPaymentValue: paymentValue,
  });

  console.log(`Usuário ${userId} atualizado para plano PAGO`);

  // Verifica se há indicação para creditar Applicash (10% do valor)
  if (userData.indicadoPor) {
    const indicadorDocRef = adminFirestore.collection('users').doc(userData.indicadoPor);
    const indicadorDoc = await indicadorDocRef.get();
    
    if (indicadorDoc.exists) {
      const indicadorData = indicadorDoc.data()!;
      const currentBalance = indicadorData.applicashBalance || 0;
      const commission = paymentValue * 0.10; // 10% de comissão
      const newBalance = currentBalance + commission;

      await indicadorDocRef.update({
        applicashBalance: newBalance,
        updatedAt: new Date().toISOString(),
        // Adiciona registro do ganho (opcional, para histórico)
        applicashHistory: adminFirestore.FieldValue.arrayUnion({
          type: 'referral_commission',
          amount: commission,
          fromUser: userId,
          date: new Date().toISOString(),
          description: 'Comissão por indicação (10%)',
        }),
      });

      console.log(
        `Applicash creditado: R$ ${commission.toFixed(2)} para ${indicadorData.email} (saldo: R$ ${newBalance.toFixed(2)})`
      );
    } else {
      console.warn(`Indicador ${userData.indicadoPor} não encontrado`);
    }
  }
}

/**
 * Handler principal do webhook
 */
export async function POST(request: NextRequest) {
  try {
    // Obtém a assinatura do header
    const signature = request.headers.get('X-Signature');
    
    if (!signature) {
      console.warn('Webhook Asaas recebido sem assinatura');
      return NextResponse.json(
        { error: 'Assinatura ausente' },
        { status: 401 }
      );
    }

    // Obtém o payload bruto para validação
    const rawBody = await request.text();
    
    // Valida a assinatura
    const isValid = validateAsaasSignature(rawBody, signature);
    
    if (!isValid) {
      console.error('Assinatura do webhook inválida');
      return NextResponse.json(
        { error: 'Assinatura inválida' },
        { status: 401 }
      );
    }

    // Parse do JSON
    const eventData: AsaasWebhookEvent = JSON.parse(rawBody);
    const { event, data } = eventData;

    console.log(`Webhook Asaas recebido: ${event}`);

    // Processa diferentes tipos de eventos
    switch (event) {
      case 'PAYMENT_CONFIRMED':
        await handlePaymentConfirmed(data);
        break;
        
      case 'PAYMENT_CREATED':
        console.log('Pagamento criado:', data.id);
        break;
        
      case 'PAYMENT_OVERDUE':
        console.log('Pagamento vencido:', data.id);
        break;
        
      case 'PAYMENT_DELETED':
        console.log('Pagamento removido:', data.id);
        break;
        
      default:
        console.log(`Evento não tratado: ${event}`);
    }

    // Retorna sucesso para o Asaas
    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('Erro ao processar webhook Asaas:', error);
    return NextResponse.json(
      { error: 'Erro interno no processamento do webhook' },
      { status: 500 }
    );
  }
}
