import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);
  const authChangedRef = useRef(false);

  useEffect(() => {
    // Listener is the source of truth. If it fires before getSession resolves,
    // we ignore the getSession result to avoid overwriting a fresh session
    // (e.g. one set by signUp/signInWithStudio) with a stale mount-time value.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authChangedRef.current = true;
      setSession(session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (authChangedRef.current) return;
      setSession(session);
      setLoading(false);
    });

    // Safety net: if neither onAuthStateChange nor getSession resolves
    // within 5 seconds (e.g. network issues), stop blocking the UI.
    const timeout = setTimeout(() => {
      if (!authChangedRef.current) {
        setSession(null);
        setLoading(false);
      }
    }, 5000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error };
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signUp(email, password, displayName) {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
    try {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      // res.json() throws on a non-JSON error page (e.g. a Cloudflare 502
      // HTML body); catch so the caller always gets a result and clears its
      // loading state instead of hanging on an unhandled rejection.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: { message: body.error || 'Sign-up failed' } };
      await supabase.auth.setSession(body.session);
      return { error: null };
    } catch {
      return { error: { message: 'Network error — please try again' } };
    }
  }

  async function signInWithStudio(email, password) {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
    try {
      const res = await fetch(`${API_URL}/api/auth/studio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: { message: body.error || 'Sign-in failed' } };
      await supabase.auth.setSession(body.session);
      return { error: null };
    } catch {
      return { error: { message: 'Network error — please try again' } };
    }
  }

  async function signOut() {
    // Always clear local session even if the network sign-out rejects, so the
    // UI never gets stuck in a logged-in state on a failed request.
    try {
      await supabase.auth.signOut();
    } finally {
      setSession(null);
    }
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signInWithEmail,
    signInWithPassword,
    signUp,
    signInWithStudio,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
