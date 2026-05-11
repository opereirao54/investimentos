import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export interface UserData {
  uid: string;
  email: string;
  displayName: string | null;
  plano: 'gratis' | 'pago';
  applicashBalance: number;
  couponCode: string;
  referredBy: string | null;
  referralCount?: number;
  totalApplicashEarned?: number;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/**
 * Obter dados do utilizador no Firestore
 */
export async function getUserData(uid: string): Promise<UserData | null> {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      return {
        uid: userSnap.id,
        ...userSnap.data(),
      } as UserData;
    }

    return null;
  } catch (error) {
    console.error('Erro ao obter dados do utilizador:', error);
    return null;
  }
}

/**
 * Verificar se cupão de indicação é válido
 */
export async function validateReferralCoupon(couponCode: string): Promise<{
  valid: boolean;
  referrerId?: string;
  referrerName?: string;
}> {
  try {
    const trimmedCoupon = couponCode.trim().toUpperCase();
    
    // Validar formato
    const couponPattern = /^APP-[A-Z0-9]{6}$/;
    if (!couponPattern.test(trimmedCoupon)) {
      return { valid: false };
    }

    // Procurar utilizador com este cupão
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('couponCode', '==', trimmedCoupon).limit(1).get();

    if (!snapshot.empty) {
      const referrerDoc = snapshot.docs[0];
      const referrerData = referrerDoc.data();
      
      return {
        valid: true,
        referrerId: referrerDoc.id,
        referrerName: referrerData.displayName || referrerData.email,
      };
    }

    return { valid: false };
  } catch (error) {
    console.error('Erro ao validar cupão:', error);
    return { valid: false };
  }
}
