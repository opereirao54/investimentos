// Utilitários para gestão de cookies de sessão JWT
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET || 'fallback-secret-key-min-32-characters-long';
const key = new TextEncoder().encode(secretKey);

export interface SessionPayload {
  uid: string;
  email: string;
  exp: number;
}

/**
 * Cria um cookie de sessão JWT assinado
 */
export async function createSessionCookie(idToken: string): Promise<string> {
  // Verifica o token do Firebase e extrai o payload
  const decodedToken = await jwtVerify(idToken, key);
  const payload = decodedToken.payload as SessionPayload;

  // Cria um novo cookie com duração de 7 dias
  const sessionPayload = {
    uid: payload.uid,
    email: payload.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 dias
  };

  return new SignJWT(sessionPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

/**
 * Verifica e retorna o payload da sessão
 */
export async function verifySession(sessionCookie: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(sessionCookie, key);
    return payload as SessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Obtém o cookie de sessão dos headers
 */
export async function getSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get('session')?.value;
}

/**
 * Remove o cookie de sessão (logout)
 */
export async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}
