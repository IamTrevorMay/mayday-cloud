import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Drive from './pages/Drive';
import DropPage from './pages/DropPage';

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div style={s.loadingScreen}>
        <div style={s.loadingLogo}>Mayday Cloud</div>
        <div style={s.loadingDots}>Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public: share link drop page */}
      <Route path="/drop/:token" element={<DropPage />} />

      {/* Auth-gated routes */}
      {session ? (
        <>
          <Route path="/" element={<Drive />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
    </Routes>
  );
}

const s = {
  loadingScreen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: '16px',
  },
  loadingLogo: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e2e8f0',
    letterSpacing: '-0.5px',
  },
  loadingDots: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
  },
};
