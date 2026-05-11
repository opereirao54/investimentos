'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cupomReferral, setCupomReferral] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, password, cupomReferral }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao criar conta');
      }

      // Registro bem-sucedido
      setSuccess(true);
      
      // Redireciona para login após 2 segundos
      setTimeout(() => {
        router.push('/login?registered=true');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sb-dark via-sb-dark2 to-sb-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo e título */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold font-syne text-white mb-2">
            Appliquei
          </h1>
          <p className="text-sb-text text-sm">
            Comece grátis • Upgrade quando quiser
          </p>
        </div>

        {/* Card de registro */}
        <div className="bg-sb-dark2 border border-sb-border rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6 text-center">
            Crie sua conta grátis
          </h2>

          {success && (
            <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
              <p className="text-green-400 text-sm">
                ✅ Conta criada com sucesso! Redirecionando...
              </p>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Nome */}
            <div>
              <label htmlFor="nome" className="block text-sm font-medium text-sb-text mb-2">
                Nome completo
              </label>
              <input
                id="nome"
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full px-4 py-3 bg-sb-dark border border-sb-border rounded-xl text-white placeholder-sb-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="Seu nome"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-sb-text mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-sb-dark border border-sb-border rounded-xl text-white placeholder-sb-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="seu@email.com"
              />
            </div>

            {/* Senha */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-sb-text mb-2">
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-sb-dark border border-sb-border rounded-xl text-white placeholder-sb-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="Mínimo 6 caracteres"
              />
              <p className="text-xs text-sb-text-muted mt-1">
                Mínimo de 6 caracteres
              </p>
            </div>

            {/* Cupom de Referral (opcional) */}
            <div>
              <label htmlFor="cupomReferral" className="block text-sm font-medium text-sb-text mb-2">
                Código de indicação <span className="text-sb-text-muted">(opcional)</span>
              </label>
              <input
                id="cupomReferral"
                type="text"
                value={cupomReferral}
                onChange={(e) => setCupomReferral(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-sb-dark border border-sb-border rounded-xl text-white placeholder-sb-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono uppercase tracking-wider"
                placeholder="EX: ABC12345"
              />
              <p className="text-xs text-sb-text-muted mt-1">
                Ganhe benefícios se foi indicado por alguém
              </p>
            </div>

            {/* Botão de submit */}
            <button
              type="submit"
              disabled={loading || success}
              className="w-full bg-primary hover:bg-primary-hover disabled:bg-sb-border disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-primary/25"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Criando conta...
                </span>
              ) : success ? (
                'Conta criada!'
              ) : (
                'Criar conta grátis'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-sb-border"></div>
            <span className="text-xs text-sb-text-muted">ou</span>
            <div className="flex-1 h-px bg-sb-border"></div>
          </div>

          {/* Link de login */}
          <p className="text-center text-sm text-sb-text">
            Já tem uma conta?{' '}
            <Link 
              href="/login" 
              className="text-primary hover:text-primary-hover font-medium transition-colors"
            >
              Fazer login
            </Link>
          </p>

          {/* Informações do plano gratuito */}
          <div className="mt-6 pt-6 border-t border-sb-border">
            <div className="bg-sb-dark border border-sb-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Plano Gratuito inclui:</h3>
              <ul className="space-y-1 text-xs text-sb-text">
                <li className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Acesso à plataforma
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Código de indicação próprio
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Upgrade a qualquer momento
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-sb-text-muted mt-6">
          © 2024 Appliquei • Todos os direitos reservados
        </p>
      </div>
    </div>
  );
}
