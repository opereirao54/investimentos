import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware de proteção de rotas
 * 
 * Verifica se o utilizador está autenticado antes de permitir acesso a rotas protegidas.
 * Rotas protegidas: /dashboard, /applicash, /settings, etc.
 * Rotas públicas: /login, /register, /
 */

// Lista de rotas que requerem autenticação
const protectedRoutes = ['/dashboard', '/applicash', '/settings', '/profile', '/assinatura'];

// Lista de rotas de autenticação (redirecionam para dashboard se já estiver logado)
const authRoutes = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Obter token de sessão (cookie ou localStorage via client-side)
  // Nota: Para Firebase Auth, normalmente verificamos no client-side
  // Mas podemos usar cookies de sessão se implementarmos server-side auth
  
  const sessionCookie = request.cookies.get('session')?.value;
  const isLoggedIn = !!sessionCookie;

  // Verificar se é uma rota protegida
  const isProtectedRoute = protectedRoutes.some(route => 
    pathname.startsWith(route)
  );

  // Verificar se é uma rota de autenticação
  const isAuthRoute = authRoutes.some(route => 
    pathname.startsWith(route)
  );

  // Se está tentando acessar rota protegida sem autenticação
  if (isProtectedRoute && !isLoggedIn) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Se está tentando acessar login/register mas já está logado
  if (isAuthRoute && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

// Configurar em quais rotas o middleware deve rodar
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|_next).*)',
  ],
};
