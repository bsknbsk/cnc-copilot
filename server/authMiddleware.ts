import { Request, Response, NextFunction } from 'express';
import { adminAuth, adminDb } from './firebase.js';
import { ADMIN_EMAILS } from './config.js';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: 'user' | 'admin';
  displayName?: string;
  photoURL?: string;
  preferredLanguage?: 'en' | 'hi' | 'ml' | 'ta';
  preferredController?: 'fanuc' | 'mitsubishi' | 'generic';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or malformed Authorization header' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1]?.trim();
  if (!idToken) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing token' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(email);
    const role: 'user' | 'admin' = isAdmin ? 'admin' : 'user';

    let preferredLanguage: 'en' | 'hi' | 'ml' | 'ta' = 'en';
    let preferredController: 'fanuc' | 'mitsubishi' | 'generic' = 'fanuc';

    // Best-effort sync to Firestore user doc (graceful fallback if admin service account lacks write permission)
    try {
      const userRef = adminDb.collection('users').doc(decoded.uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        await userRef.set({
          displayName: decoded.name || decoded.email?.split('@')[0] || 'Operator',
          email: decoded.email || '',
          photoURL: decoded.picture || '',
          preferredLanguage: 'en',
          preferredController: 'fanuc',
          role,
          createdAt: new Date().toISOString(),
        }, { merge: true });
      } else {
        const data = userSnap.data();
        preferredLanguage = data?.preferredLanguage || 'en';
        preferredController = data?.preferredController || 'fanuc';
        if (data?.role !== role) {
          await userRef.update({ role });
        }
      }
    } catch (err: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'requireAuth:userSync', error: err?.message || String(err) }));
      // Graceful fallback: role is already securely enforced from ADMIN_EMAILS & verified ID token
    }

    req.user = {
      uid: decoded.uid,
      email,
      role,
      displayName: decoded.name || decoded.email?.split('@')[0] || 'Operator',
      photoURL: decoded.picture || '',
      preferredLanguage,
      preferredController,
    };

    next();
  } catch (error: any) {
    console.error('[authMiddleware] Token verification failed:', error?.message);
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
    return;
  }
  next();
}
