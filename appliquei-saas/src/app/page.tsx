import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

/**
 * Página inicial
 * Redireciona para /dashboard se autenticado, senão para /login
 */
export default function Home() {
  const sessionCookie = cookies().get('session')?.value;
  
  if (sessionCookie) {
    redirect('/dashboard');
  } else {
    redirect('/login');
  }
}
