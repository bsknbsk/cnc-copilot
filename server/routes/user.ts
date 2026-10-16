import { Router } from 'express';
import { requireAuth } from '../authMiddleware.js';
import { adminDb } from '../firebase.js';

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get('/me', async (req, res) => {
  try {
    const uid = req.user!.uid;
    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (userDoc.exists) {
      res.json({ ...req.user, ...userDoc.data() });
      return;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'GET /api/user/me', error: err?.message || String(err) }));
    // If adminDb cannot reach Firestore, fallback gracefully to token payload
  }
  res.json(req.user);
});

userRouter.patch('/preferences', async (req, res) => {
  try {
    const uid = req.user!.uid;
    const { preferredLanguage, preferredController } = req.body;
    const updates: Record<string, any> = {};

    if (preferredLanguage && ['en', 'hi', 'ml', 'ta'].includes(preferredLanguage)) {
      updates.preferredLanguage = preferredLanguage;
    }
    if (preferredController && ['fanuc', 'mitsubishi', 'generic'].includes(preferredController)) {
      updates.preferredController = preferredController;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await adminDb.collection('users').doc(uid).set(updates, { merge: true });
      } catch (err: any) {
        console.warn(JSON.stringify({ level: 'warn', route: 'PATCH /api/user/preferences:dbSet', error: err?.message || String(err) }));
        // Fallback: client SDK also updates users/{uid} directly
      }
    }

    res.json({ success: true, updates });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'PATCH /api/user/preferences', error: err?.message || String(err) }));
    res.status(500).json({ error: 'failed_to_update_preferences', message: err.message });
  }
});

userRouter.get('/activity', async (req, res) => {
  try {
    const uid = req.user!.uid;
    const snap = await adminDb
      .collection('users')
      .doc(uid)
      .collection('activity')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(items);
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'GET /api/user/activity', error: err?.message || String(err) }));
    res.json([]);
  }
});
