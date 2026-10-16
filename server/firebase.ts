import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FIREBASE_PROJECT_ID, STORAGE_BUCKET } from './config.js';

let appInstance: any = null;

try {
  const apps = getApps();
  if (!apps.length) {
    appInstance = initializeApp({
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    });
  } else {
    appInstance = apps[0];
  }
} catch (err) {
  console.warn('[firebase-admin] Warning initializing with applicationDefault():', err);
  const apps = getApps();
  if (!apps.length) {
    try {
      appInstance = initializeApp({
        projectId: FIREBASE_PROJECT_ID,
        storageBucket: STORAGE_BUCKET,
      });
    } catch (fallbackErr) {
      console.error('[firebase-admin] Fallback initialization error:', fallbackErr);
    }
  } else {
    appInstance = apps[0];
  }
}

export const FIRESTORE_DATABASE_ID = 'ai-studio-cnccopilot-3768fe9c-394b-4869-a3b5-72b028948598';

export const adminAuth = getAuth(appInstance);
export const adminDb = getFirestore(appInstance, FIRESTORE_DATABASE_ID);
export const adminStorage = getStorage(appInstance);
