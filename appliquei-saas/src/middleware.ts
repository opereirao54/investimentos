import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession } from '@/lib/session';

// Rotas que requerem autenticação
const protectedRoutes = ['/dashboard'];

// Rotas públicas (login, registro, etc.)
const publicRoutes = ['/login', '/register'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Obtém o cookie de sessão
  const sessionCookie = request.cookies.get('session')?.value;

  // Verifica se a rota é protegida
  const isProtectedRoute = protectedRoutes.some(route => 
    pathname.startsWith(route)
  );

  // Verifica se a rota é pública
  const isPublicRoute = publicRoutes.some(route => 
    pathname.startsWith(route)
  );

  // Se não há sessão e tenta acessar rota protegida
  if (isProtectedRoute && !sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Se há sessão válida e tenta acessar login/register, redireciona para dashboard
  if (isPublicRoute && sessionCookie) {
    const session = await verifySession(sessionCookie);
    if (session) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Se há sessão mas é inválida em rota protegida
  if (isProtectedRoute && sessionCookie) {
    const session = await verifySession(sessionCookie);
    if (!session) {
      // Sessão inválida, remove cookie e redireciona para login
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete('session');
      return response;
    }
  }

  return NextResponse.next();
}

// Configura em quais rotas o middleware deve rodar
export const config = {
  matcher: [
    /*
     * Match todas as rotas exceto:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (assets)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
