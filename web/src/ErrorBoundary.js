import React from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Post to API error endpoint (fire-and-forget)
    fetch(`${API_URL}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={s.container}>
          <div style={s.card}>
            <h1 style={s.heading}>Something went wrong</h1>
            <p style={s.message}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button style={s.button} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const s = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '20px',
  },
  card: {
    textAlign: 'center',
    maxWidth: '400px',
    padding: '40px 32px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
  },
  heading: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 12px',
  },
  message: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 24px',
    lineHeight: 1.5,
  },
  button: {
    padding: '10px 24px',
    border: 'none',
    borderRadius: '8px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
