import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, loginWithGoogle, logoutUser, apiFetch } from '../lib/firebase.js';

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL?: string;
  preferredLanguage: 'en' | 'hi' | 'ml' | 'ta';
  preferredController: 'fanuc' | 'mitsubishi' | 'generic';
  role: 'user' | 'admin';
  badges?: string[];
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (updates: { preferredLanguage?: 'en' | 'hi' | 'ml' | 'ta'; preferredController?: 'fanuc' | 'mitsubishi' | 'generic' }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      let serverProfile: Partial<UserProfile> = {};
      // Fetch authoritative role & profile metadata from server
      try {
        const res = await apiFetch('/api/user/me');
        if (res.ok) {
          serverProfile = await res.json();
          setProfile(prev => ({
            displayName: currentUser.displayName || 'Operator',
            email: currentUser.email || '',
            photoURL: currentUser.photoURL || '',
            preferredLanguage: (serverProfile.preferredLanguage as any) || 'en',
            preferredController: (serverProfile.preferredController as any) || 'fanuc',
            role: serverProfile.role || 'user',
            ...prev,
            ...serverProfile,
          }));
        }
      } catch (err) {
        console.warn('[AuthProvider] /api/user/me fetch notice:', err);
      }

      // Check and initialize user document in Firestore directly from client SDK
      const userDocRef = doc(db, 'users', currentUser.uid);
      try {
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          const initialData: UserProfile = {
            displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Operator',
            email: currentUser.email || '',
            photoURL: currentUser.photoURL || '',
            preferredLanguage: (serverProfile.preferredLanguage as any) || 'en',
            preferredController: (serverProfile.preferredController as any) || 'fanuc',
            role: serverProfile.role || 'user',
            createdAt: new Date().toISOString(),
          };
          await setDoc(userDocRef, initialData, { merge: true });
          setProfile(initialData);
        } else {
          setProfile(snap.data() as UserProfile);
        }
      } catch (err) {
        console.warn('[AuthProvider] Firestore client doc init notice:', err);
      }

      // Listen to users/{uid} in real-time
      const unsubscribeDoc = onSnapshot(
        userDocRef,
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          }
          setLoading(false);
        },
        (_error) => {
          setLoading(false);
        }
      );

      return () => unsubscribeDoc();
    });

    return () => unsubscribeAuth();
  }, []);

  const login = async () => {
    try {
      await loginWithGoogle();
    } catch (err: any) {
      // Gracefully handle popup cancellation without raising uncaught exceptions
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        return;
      }
      console.error('Google Sign In error:', err?.message || err);
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch (err: any) {
      console.error('Sign Out error:', err?.message || err);
    }
  };

  const updatePreferences = async (updates: { preferredLanguage?: 'en' | 'hi' | 'ml' | 'ta'; preferredController?: 'fanuc' | 'mitsubishi' | 'generic' }) => {
    try {
      // Update local state immediately for responsive UI
      setProfile((prev) => (prev ? { ...prev, ...updates } : null));

      // Update Firestore document directly from client
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, updates, { merge: true });
      }

      // Sync with server
      await apiFetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.warn('Failed to update preferences:', err);
    }
  };

  const isAdmin = useMemo(() => {
    return profile?.role === 'admin';
  }, [profile?.role]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin,
        login,
        logout,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
