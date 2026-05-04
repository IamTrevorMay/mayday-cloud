import React, { useState, useEffect } from 'react';

const GITHUB_REPO = 'trevor-may/mayday-cloud';

function detectOS() {
  const p = navigator.platform?.toLowerCase() || '';
  const ua = navigator.userAgent?.toLowerCase() || '';
  if (p.includes('mac') || ua.includes('macintosh')) return 'mac';
  if (p.includes('win') || ua.includes('windows')) return 'windows';
  if (p.includes('linux') || ua.includes('linux')) return 'linux';
  return 'mac';
}

const PLATFORMS = {
  mac: {
    name: 'macOS',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
    filePattern: '.dmg',
    label: 'Download for Mac',
  },
  windows: {
    name: 'Windows',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 12V6.75l6-1.32v6.48L3 12zm6.73-.07l8.27-.9V4.59l-8.27 1.23v6.11zM18 12.29l-8.27.6v6.17l8.27 1.35V12.29zM9 12.8l-6 .46v5.98l6-1.31V12.8z" />
      </svg>
    ),
    filePattern: '.exe',
    label: 'Download for Windows',
  },
  linux: {
    name: 'Linux',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.5 2c-1.5 0-2.5 1.12-2.5 3v1.28c-1.57.7-2.5 2.08-2.5 3.72 0 1.5.5 2.63 1.16 3.5-.6.71-1.16 1.68-1.16 3 0 1.1.3 1.86.63 2.35-.42.4-.63.93-.63 1.65 0 1.38 1.12 2.5 2.5 2.5h5c1.38 0 2.5-1.12 2.5-2.5 0-.72-.21-1.25-.63-1.65.33-.49.63-1.25.63-2.35 0-1.32-.56-2.29-1.16-3 .66-.87 1.16-2 1.16-3.5 0-1.64-.93-3.02-2.5-3.72V5c0-1.88-1-3-2.5-3z" />
      </svg>
    ),
    filePattern: '.AppImage',
    label: 'Download for Linux',
  },
};

export default function Download() {
  const [os, setOS] = useState(detectOS);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    // Try to fetch latest release version
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then(r => r.json())
      .then(data => {
        if (data.tag_name) setVersion(data.tag_name);
      })
      .catch(() => {});
  }, []);

  const primary = PLATFORMS[os];
  const others = Object.entries(PLATFORMS).filter(([k]) => k !== os);

  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/latest`;

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoSection}>
          <div style={s.logoIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h1 style={s.logo}>Mayday Cloud</h1>
          <p style={s.tagline}>Sync your files automatically</p>
        </div>

        <a href={downloadUrl} style={s.primaryBtn} target="_blank" rel="noopener noreferrer">
          <span style={s.btnIcon}>{primary.icon}</span>
          <span>
            <div style={s.btnLabel}>{primary.label}</div>
            {version && <div style={s.btnVersion}>{version}</div>}
          </span>
        </a>

        <div style={s.otherPlatforms}>
          <div style={s.otherLabel}>Also available for</div>
          <div style={s.otherLinks}>
            {others.map(([key, platform]) => (
              <a
                key={key}
                href={downloadUrl}
                style={s.otherLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOS(key)}
              >
                {platform.name}
              </a>
            ))}
          </div>
        </div>

        <div style={s.features}>
          <div style={s.feature}>
            <span style={s.featureIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </span>
            Automatic background sync
          </div>
          <div style={s.feature}>
            <span style={s.featureIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </span>
            Resumes interrupted uploads
          </div>
          <div style={s.feature}>
            <span style={s.featureIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </span>
            Launches on login automatically
          </div>
        </div>
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
    maxWidth: '440px',
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
    fontSize: '28px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: '0 0 6px',
    letterSpacing: '-0.5px',
  },
  tagline: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '16px 24px',
    background: '#6366f1',
    color: '#fff',
    borderRadius: '12px',
    textDecoration: 'none',
    fontSize: '16px',
    fontWeight: 600,
    transition: 'opacity 0.15s',
    marginBottom: '20px',
  },
  btnIcon: {
    display: 'flex',
    alignItems: 'center',
  },
  btnLabel: {
    fontSize: '16px',
    fontWeight: 600,
  },
  btnVersion: {
    fontSize: '12px',
    opacity: 0.7,
  },
  otherPlatforms: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  otherLabel: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: '8px',
  },
  otherLinks: {
    display: 'flex',
    justifyContent: 'center',
    gap: '16px',
  },
  otherLink: {
    fontSize: '13px',
    color: '#818cf8',
    textDecoration: 'none',
  },
  features: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    paddingTop: '20px',
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
  },
  featureIcon: {
    color: '#4ade80',
    display: 'flex',
    alignItems: 'center',
  },
};
