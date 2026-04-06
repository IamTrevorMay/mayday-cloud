import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signInWithEmail(email);
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
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

        {sent ? (
          <div style={s.sentMessage}>
            Check <strong>{email}</strong> for a sign-in link.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={s.form}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
              required
              style={s.input}
              autoFocus
            />
            <button type="submit" disabled={loading} style={s.button}>
              {loading ? 'Sending...' : 'Send Magic Link'}
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
    marginBottom: '32px',
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
  sentMessage: {
    textAlign: 'center',
    fontSize: '15px',
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.5,
  },
};
