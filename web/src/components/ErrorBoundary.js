import React from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Fire-and-forget error report
    fetch(`${API_URL}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(error?.message || '').slice(0, 500),
        stack: String(error?.stack || '').slice(0, 2000),
        componentStack: String(info?.componentStack || '').slice(0, 1000),
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={s.container}>
          <div style={s.card}>
            <h1 style={s.title}>Something went wrong</h1>
            <p style={s.text}>
              An unexpected error occurred. Please try reloading the page.
            </p>
            <button
              style={s.button}
              onClick={() => window.location.reload()}
              onMouseEnter={(e) => (e.target.style.background = '#4f46e5')}
              onMouseLeave={(e) => (e.target.style.background = '#6366f1')}
            >
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
    height: '100vh',
    fontFamily: "'DM Sans', sans-serif",
    background: '#0f172a',
    color: '#e2e8f0',
  },
  card: {
    textAlign: 'center',
    padding: '48px',
    maxWidth: '420px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '12px',
    color: '#f1f5f9',
  },
  text: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '28px',
    lineHeight: 1.5,
  },
  button: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 28px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'background 0.15s',
  },
};
