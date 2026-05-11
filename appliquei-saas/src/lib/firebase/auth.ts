import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';

/**
 * Login com email e senha
 */
export async function login(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return {
      success: true,
      user: userCredential.user,
    };
  } catch (error: any) {
    console.error('Erro no login:', error);
    
    if (error.code === 'auth/user-not-found') {
      return {
        success: false,
        error: 'Utilizador não encontrado',
      };
    }

    if (error.code === 'auth/wrong-password') {
      return {
        success: false,
        error: 'Senha incorreta',
      };
    }

    if (error.code === 'auth/invalid-email') {
      return {
        success: false,
        error: 'Email inválido',
      };
    }

    return {
      success: false,
      error: 'Erro ao fazer login. Tente novamente.',
    };
  }
}

/**
 * Logout
 */
export async function logout() {
  try {
    await firebaseSignOut(auth);
    return { success: true };
  } catch (error) {
    console.error('Erro no logout:', error);
    return {
      success: false,
      error: 'Erro ao fazer logout',
    };
  }
}

/**
 * Obter utilizador atual
 */
export function getCurrentUser() {
  return auth.currentUser;
}
