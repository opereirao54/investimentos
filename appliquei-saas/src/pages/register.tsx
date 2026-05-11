'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Página de Registo
 * Formulário com Email, Senha e Cupão de Indicação (opcional)
 */
export default function RegisterPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    referralCoupon: '',
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validações
    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (formData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          displayName: formData.displayName || undefined,
          referralCoupon: formData.referralCoupon || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Registo bem-sucedido
        // Em produção, fazer login automático ou redirecionar para confirmação
        router.push('/login?registered=true');
      } else {
        setError(data.error || 'Erro ao criar conta');
      }
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-main-fundo px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-syne text-3xl font-bold text-primaria mb-2">
            Appliquei
          </h1>
          <p className="text-main-texto-mutado text-sm">
            Crie sua conta grátis
          </p>
        </div>

        {/* Card de Registo */}
        <div className="bg-cor-branco rounded-[14px] border border-cor-borda shadow-card p-8">
          <h2 className="font-syne text-xl font-bold text-cor-texto-principal mb-6">
            Criar nova conta
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-cor-bg-erro border border-cor-borda-erro rounded-[9px]">
              <p className="text-cor-txt-erro text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Nome (opcional) */}
            <div>
              <label
                htmlFor="displayName"
                className="block text-[11px] font-semibold text-cor-texto-mutado uppercase tracking-wide mb-2"
              >
                Nome (opcional)
              </label>
              <input
                type="text"
                id="displayName"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="Seu nome"
              />
            </div>

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
                name="email"
                value={formData.email}
                onChange={handleChange}
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
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="••••••••"
                required
              />
            </div>

            {/* Confirmar Senha */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-[11px] font-semibold text-cor-texto-mutado uppercase tracking-wide mb-2"
              >
                Confirmar Senha
              </label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="••••••••"
                required
              />
            </div>

            {/* Cupão de Indicação (opcional) */}
            <div>
              <label
                htmlFor="referralCoupon"
                className="block text-[11px] font-semibold text-cor-texto-mutado uppercase tracking-wide mb-2"
              >
                Cupão de Indicação (opcional)
              </label>
              <input
                type="text"
                id="referralCoupon"
                name="referralCoupon"
                value={formData.referralCoupon}
                onChange={handleChange}
                className="w-full px-[13px] py-[10px] border-[1.5px] border-cor-borda rounded-[9px] text-[14px] focus:border-primaria focus:outline-none focus:ring-2 focus:ring-primaria/10 transition-all bg-cor-branco text-cor-texto-principal"
                placeholder="APP-XXXXXX"
              />
              <p className="mt-2 text-[11px] text-cor-texto-mutado">
                Tem um código de convite? Insira-o aqui para apoiar quem indicou.
              </p>
            </div>

            {/* Botão Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-[11px] px-[18px] bg-primaria hover:bg-primaria-hover text-white font-semibold rounded-[9px] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-suave"
            >
              {loading ? 'Criando conta...' : 'Criar Conta'}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 text-center">
            <p className="text-sm text-cor-texto-secundario">
              Já tem uma conta?{' '}
              <Link
                href="/login"
                className="text-primaria hover:text-primaria-hover font-semibold"
              >
                Entrar
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
