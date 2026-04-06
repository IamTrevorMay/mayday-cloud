import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function DropPage() {
  const { token } = useParams();
  const [linkInfo, setLinkInfo] = useState(null); // null=loading, false=invalid
  const [uploads, setUploads] = useState([]); // [{name, status, error}]
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);

  // Download state
  const [downloadFiles, setDownloadFiles] = useState([]);
  const [downloadLoading, setDownloadLoading] = useState(false);

  // Validate the share link
  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`${API_URL}/api/drop/${token}`);
        if (!res.ok) { setLinkInfo(false); return; }
        const data = await res.json();
        setLinkInfo(data);
      } catch {
        setLinkInfo(false);
      }
    }
    validate();
  }, [token]);

  // Fetch download files when link supports download
  useEffect(() => {
    if (!linkInfo || linkInfo.mode === 'upload') return;
    async function fetchFiles() {
      setDownloadLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/drop/${token}/download`);
        if (!res.ok) return;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data.type === 'directory') {
            setDownloadFiles(data.files || []);
          } else {
            // Single file — no file list needed
            setDownloadFiles([]);
          }
        }
      } catch {
        // ignore
      } finally {
        setDownloadLoading(false);
      }
    }
    fetchFiles();
  }, [linkInfo, token]);

  const handleFiles = useCallback(async (files) => {
    const fileList = Array.from(files);
    for (const file of fileList) {
      const id = Date.now() + '_' + file.name;
      setUploads(prev => [...prev, { id, name: file.name, status: 'uploading' }]);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_URL}/api/drop/${token}/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Upload failed');
        }

        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'done' } : u));
      } catch (err) {
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: err.message } : u));
      }
    }
  }, [token]);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  function handleDownloadFile(fileName) {
    const url = `${API_URL}/api/drop/${token}/download?file=${encodeURIComponent(fileName)}`;
    window.open(url, '_blank');
  }

  function handleDownloadSingle() {
    const url = `${API_URL}/api/drop/${token}/download`;
    window.open(url, '_blank');
  }

  // ─── Invalid link ───
  if (linkInfo === false) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.iconWrap}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1 style={s.title}>Link expired or invalid</h1>
          <p style={s.subtitle}>This link is no longer active. Ask the sender for a new one.</p>
        </div>
      </div>
    );
  }

  // ─── Loading ───
  if (linkInfo === null) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>Checking link...</div>
        </div>
      </div>
    );
  }

  // ─── Main content ───
  const showUpload = linkInfo.mode === 'upload' || linkInfo.mode === 'both';
  const showDownload = linkInfo.mode === 'download' || linkInfo.mode === 'both';
  const isDirectory = linkInfo.target_type === 'directory';
  const doneCount = uploads.filter(u => u.status === 'done').length;
  const allDone = uploads.length > 0 && uploads.every(u => u.status === 'done' || u.status === 'error');

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Mayday Cloud</span>
        </div>

        <h1 style={s.title}>
          {showUpload && showDownload ? 'Shared files' : showDownload ? 'Download files' : 'Upload files'}
        </h1>
        {linkInfo.created_by_email && (
          <p style={s.subtitle}>Shared by {linkInfo.created_by_email}</p>
        )}

        {/* Download section */}
        {showDownload && (
          <div style={{ marginBottom: showUpload ? '24px' : '0' }}>
            {downloadLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', padding: '16px 0' }}>Loading files...</div>
            ) : isDirectory && downloadFiles.length > 0 ? (
              <div style={s.fileList}>
                {downloadFiles.map((f, i) => (
                  <div key={i} style={s.fileRow}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                      <path d="M4 2h8l4 4v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM12 2v4h4" />
                    </svg>
                    <span style={s.fileRowName}>{f.name}</span>
                    <button onClick={() => handleDownloadFile(f.name)} style={s.dlBtn}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v9M4 8l4 4 4-4M2 13h12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : isDirectory && downloadFiles.length === 0 && !downloadLoading ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px', padding: '16px 0' }}>No files available for download.</div>
            ) : (
              <button onClick={handleDownloadSingle} style={s.downloadBtn}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v9M4 8l4 4 4-4M2 13h12" /></svg>
                Download File
              </button>
            )}
          </div>
        )}

        {/* Divider between download and upload */}
        {showDownload && showUpload && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginBottom: '20px' }} />
        )}

        {/* Upload section */}
        {showUpload && (
          <>
            {showDownload && <div style={{ fontSize: '15px', fontWeight: 600, color: '#e2e8f0', marginBottom: '12px' }}>Upload files</div>}
            <div
              style={{ ...s.dropZone, ...(dragOver ? s.dropZoneActive : {}) }}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => document.getElementById('drop-input').click()}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#6366f1' : 'rgba(255,255,255,0.2)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div style={{ fontSize: '15px', fontWeight: 500, color: dragOver ? '#a5b4fc' : 'rgba(255,255,255,0.5)', marginTop: '12px' }}>
                {dragOver ? 'Drop here' : 'Drag files here or click to browse'}
              </div>
              <input
                id="drop-input"
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {/* Upload list */}
            {uploads.length > 0 && (
              <div style={s.uploadList}>
                {uploads.map(u => (
                  <div key={u.id} style={s.uploadRow}>
                    <span style={s.uploadName}>{u.name}</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: u.status === 'done' ? '#86efac' : u.status === 'error' ? '#fca5a5' : '#a5b4fc' }}>
                      {u.status === 'uploading' ? 'Uploading...' : u.status === 'done' ? 'Done' : u.error || 'Error'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {allDone && doneCount > 0 && (
              <div style={s.successMsg}>
                {doneCount} file{doneCount !== 1 ? 's' : ''} uploaded successfully.
              </div>
            )}
          </>
        )}

        {error && <div style={s.errorMsg}>{error}</div>}

        {linkInfo.expires_at && (
          <div style={s.expiryNote}>
            Link expires {new Date(linkInfo.expires_at).toLocaleDateString()}
          </div>
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
    background: '#0f0f1a',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '32px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '20px',
  },
  iconWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: '0 0 6px',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 20px',
  },
  dropZone: {
    border: '2px dashed rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  dropZoneActive: {
    borderColor: 'rgba(99,102,241,0.5)',
    background: 'rgba(99,102,241,0.05)',
  },
  uploadList: {
    marginTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  uploadRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  uploadName: {
    fontSize: '13px',
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '250px',
  },
  successMsg: {
    marginTop: '16px',
    padding: '12px 16px',
    borderRadius: '10px',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.2)',
    color: '#86efac',
    fontSize: '14px',
    textAlign: 'center',
    fontWeight: 500,
  },
  errorMsg: {
    marginTop: '12px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    color: '#fca5a5',
    fontSize: '13px',
  },
  expiryNote: {
    marginTop: '16px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
  },
  // Download styles
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  fileRowName: {
    flex: 1,
    fontSize: '13px',
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dlBtn: {
    padding: '6px 8px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '10px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
