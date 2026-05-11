import { verifySession } from '@/lib/session';
import { adminFirestore } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LegacyAppViewer from './LegacyAppViewer';

export default async function DashboardPage() {
  // Verifica a sessão do usuário
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session')?.value;

  if (!sessionCookie) {
    redirect('/login');
  }

  const session = await verifySession(sessionCookie);

  if (!session) {
    redirect('/login');
  }

  // Busca dados do usuário no Firestore (server-side)
  const userDoc = await adminFirestore.collection('users').doc(session.uid).get();
  
  if (!userDoc.exists) {
    // Usuário não encontrado no Firestore, redireciona para login
    redirect('/login');
  }

  const userData = userDoc.data()!;
  const plano = userData.plano || 'gratis';

  // Se o plano for grátis, mostra tela de upgrade
  if (plano === 'gratis') {
    return (
      <div className="min-h-screen bg-sb-dark text-sb-active flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-sb-dark2 border border-sb-border rounded-2xl p-8 shadow-2xl">
          <div className="text-center">
            {/* Ícone de cadeado */}
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <svg 
                className="w-8 h-8 text-primary" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
                />
              </svg>
            </div>

            <h1 className="text-2xl font-bold font-syne mb-3 text-white">
              Upgrade Necessário
            </h1>
            
            <p className="text-sb-text mb-6 leading-relaxed">
              Você está no plano <strong className="text-primary">Gratuito</strong>. 
              Para acessar o <strong className="text-white">Appliquei Completo</strong>, 
              faça upgrade para o plano Premium.
            </p>

            {/* Benefícios do plano pago */}
            <div className="bg-sb-dark border border-sb-border rounded-xl p-4 mb-6 text-left">
              <h3 className="text-sm font-semibold text-white mb-3">Plano Premium inclui:</h3>
              <ul className="space-y-2 text-sm text-sb-text">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Acesso completo ao Appliquei v13.0
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Gestão financeira ilimitada
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Dashboards e gráficos avançados
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Suporte prioritário
                </li>
              </ul>
            </div>

            {/* Botão de pagamento Asaas */}
            <div className="space-y-3">
              <a
                href={`https://sandbox.asaas.com/api/v3/paymentLinks/SEU_LINK_DE_PAGAMENTO_AQUI?externalReference=user_${session.uid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-primary hover:bg-primary-hover text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] shadow-lg hover:shadow-primary/25 text-center"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Assinar Plano Premium
                </span>
              </a>
              
              <p className="text-xs text-sb-text-muted">
                Pagamento seguro via Asaas • Cancelável a qualquer momento
              </p>
            </div>

            {/* Código de referral */}
            {userData.cupomReferral && (
              <div className="mt-6 pt-6 border-t border-sb-border">
                <p className="text-xs text-sb-text-muted mb-2">
                  Seu código de indicação:
                </p>
                <div className="bg-sb-dark border border-sb-border rounded-lg py-2 px-3 font-mono text-sm text-primary">
                  {userData.cupomReferral}
                </div>
                <p className="text-xs text-sb-text-muted mt-2">
                  Indique amigos e ganhe 10% em Applicash!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Se o plano for pago, carrega o HTML legado intacto
  return <LegacyAppViewer userId={session.uid} userEmail={userData.email} />;
}
