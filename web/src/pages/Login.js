import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { signInWithPassword, signUp, signInWithStudio } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'studio'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signInWithPassword(email, password);
    setLoading(false);
    if (error) setError(error.message);
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, displayName);
    setLoading(false);
    if (error) setError(error.message);
  }

  async function handleStudio(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signInWithStudio(email, password);
    setLoading(false);
    if (error) setError(error.message);
  }

  function switchMode(newMode) {
    setMode(newMode);
    setError(null);
    setEmail('');
    setPassword('');
    setDisplayName('');
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoSection}>
          <div style={s.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h1 style={s.logo}>Mayday Cloud</h1>
          <p style={s.tagline}>Your private cloud storage</p>
        </div>

        {/* ─── Tab switcher ─── */}
        <div style={s.tabs}>
          <button
            onClick={() => switchMode('login')}
            style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }}
          >
            Sign In
          </button>
          <button
            onClick={() => switchMode('signup')}
            style={{ ...s.tab, ...(mode === 'signup' ? s.tabActive : {}) }}
          >
            Sign Up
          </button>
        </div>

        {/* ─── Cloud Login ─── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} style={s.form}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              style={s.input}
              autoFocus
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              required
              style={s.input}
            />
            <button type="submit" disabled={loading} style={s.button}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            {error && <div style={s.error}>{error}</div>}
          </form>
        )}

        {/* ─── Cloud Sign Up ─── */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} style={s.form}>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Display name (optional)"
              style={s.input}
              autoFocus
            />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              style={s.input}
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password (min 8 characters)"
              required
              style={s.input}
            />
            <button type="submit" disabled={loading} style={s.button}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
            {error && <div style={s.error}>{error}</div>}
          </form>
        )}

        {/* ─── Divider ─── */}
        <div style={s.divider}>
          <span style={s.dividerLine} />
          <span style={s.dividerText}>or</span>
          <span style={s.dividerLine} />
        </div>

        {/* ─── Studio Login ─── */}
        {mode !== 'studio' ? (
          <button onClick={() => switchMode('studio')} style={s.studioButton}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12l2 2 4-4" />
            </svg>
            Sign in with Mayday Studio
          </button>
        ) : (
          <form onSubmit={handleStudio} style={s.form}>
            <div style={s.studioLabel}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12l2 2 4-4" />
              </svg>
              <span>Mayday Studio Credentials</span>
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Studio email"
              required
              style={s.input}
              autoFocus
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Studio password"
              required
              style={s.input}
            />
            <button type="submit" disabled={loading} style={s.studioSubmitButton}>
              {loading ? 'Connecting...' : 'Sign in with Studio'}
            </button>
            <button type="button" onClick={() => switchMode('login')} style={s.backLink}>
              Back to Cloud sign in
            </button>
            {error && <div style={s.error}>{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

const s = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '380px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '40px 32px',
  },
  logoSection: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  logoIcon: {
    marginBottom: '12px',
  },
  logo: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: '0 0 6px',
    letterSpacing: '-0.5px',
  },
  tagline: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '20px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    padding: '4px',
  },
  tab: {
    flex: 1,
    padding: '8px 12px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  tabActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    padding: '12px 16px',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '15px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  button: {
    padding: '12px 16px',
    border: 'none',
    borderRadius: '10px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  error: {
    fontSize: '13px',
    color: '#fca5a5',
    textAlign: 'center',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  studioButton: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid rgba(139,92,246,0.3)',
    borderRadius: '10px',
    background: 'rgba(139,92,246,0.08)',
    color: '#c4b5fd',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  studioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#c4b5fd',
    fontWeight: 500,
  },
  studioSubmitButton: {
    padding: '12px 16px',
    border: 'none',
    borderRadius: '10px',
    background: '#8b5cf6',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  backLink: {
    border: 'none',
    background: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
    padding: '4px',
  },
};
