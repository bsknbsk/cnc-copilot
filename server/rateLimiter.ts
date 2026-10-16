import { Request, Response, NextFunction } from 'express';
import { adminDb } from './firebase.js';

// In-memory fallback tracking for daily limits
const inMemoryUsage = new Map<string, number>();

export async function rateLimitAI(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Admins are exempt
  if (user.role === 'admin') {
    next();
    return;
  }

  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const docId = `${user.uid}_${yyyymmdd}`;

  try {
    const usageRef = adminDb.collection('usage').doc(docId);
    const allowed = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(usageRef);
      const current = snap.exists ? (snap.data()?.requests || 0) : 0;

      if (current >= 100) {
        return false;
      }

      transaction.set(usageRef, { requests: current + 1, updatedAt: new Date().toISOString() }, { merge: true });
      return true;
    });

    if (!allowed) {
      res.status(429).json({ error: 'daily_limit', message: 'Daily limit reached. Resets at midnight.' });
      return;
    }

    next();
  } catch {
    // In-memory fallback
    const current = inMemoryUsage.get(docId) || 0;
    if (current >= 100) {
      res.status(429).json({ error: 'daily_limit', message: 'Daily limit reached. Resets at midnight.' });
      return;
    }
    inMemoryUsage.set(docId, current + 1);
    next();
  }
}
