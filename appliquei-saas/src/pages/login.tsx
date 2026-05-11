'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/firebase/auth';

/**
 * Página de Login
 * Formulário simples com Email e Senha
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);

      if (result.success && result.user) {
        // Em produção, criar cookie de sessão aqui
        // Por enquanto, redirecionamos diretamente
        router.push(redirectPath);
      } else {
        setError(result.error || 'Erro ao fazer login');
      }
    } catch (err) {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-main-fundo px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-syne text-3xl font-bold text-primaria mb-2">
            Appliquei
          </h1>
          <p className="text-main-texto-mutado text-sm">
            Gestão Financeira Inteligente
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-cor-branco rounded-[14px] border border-cor-borda shadow-card p-8">
          <h2 className="font-syne text-xl font-bold text-cor-texto-principal mb-6">
            Entrar na sua conta
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-cor-bg-erro border border-cor-borda-erro rounded-[9px]">
              <p className="text-cor-txt-erro text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold text-cor-texto-mutado uppercase tracking-wide mb-2"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="seu@email.com"
                required
              />
            </div>

            {/* Senha */}
            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold text-cor-texto-mutado uppercase tracking-wide mb-2"
              >
                Senha
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="••••••••"
                required
              />
            </div>

            {/* Botão Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-[11px] px-[18px] bg-primaria hover:bg-primaria-hover text-white font-semibold rounded-[9px] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-suave"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 text-center">
            <p className="text-sm text-cor-texto-secundario">
              Não tem uma conta?{' '}
              <Link
                href="/register"
                className="text-primaria hover:text-primaria-hover font-semibold"
              >
                Registar-se
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-8 text-xs text-cor-texto-mutado">
          © 2024 Appliquei. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
