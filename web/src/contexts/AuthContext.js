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

    return () => subscription.unsubscribe();
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
    const res = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    const body = await res.json();
    if (!res.ok) return { error: { message: body.error } };
    // Set the session from the server response
    await supabase.auth.setSession(body.session);
    return { error: null };
  }

  async function signInWithStudio(email, password) {
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
    const res = await fetch(`${API_URL}/api/auth/studio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) return { error: { message: body.error } };
    await supabase.auth.setSession(body.session);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
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
