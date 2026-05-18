import React, { useEffect, useState } from 'react';
import { authedFetch } from '../lib/supabase';

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const ROLE_COLORS = {
  admin: '#f59e0b',
  member: '#6366f1',
  viewer: '#64748b',
};

export default function Admin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [roleUpdating, setRoleUpdating] = useState(null);

  useEffect(() => {
    authedFetch('/api/admin/health')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    authedFetch('/api/restrictions/admin/users')
      .then(setUsers)
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, []);

  async function handleRoleChange(userId, newRole) {
    setRoleUpdating(userId);
    try {
      const updated = await authedFetch(`/api/restrictions/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: updated.role } : u));
    } catch (err) {
      alert(`Failed to update role: ${err.message}`);
    } finally {
      setRoleUpdating(null);
    }
  }

  if (loading) {
    return <div style={s.page}><div style={s.loading}>Loading...</div></div>;
  }

  if (error) {
    return (
      <div style={s.page}>
        <div style={s.errorCard}>
          <h2 style={s.errorTitle}>Access Denied</h2>
          <p style={s.errorText}>{error}</p>
        </div>
      </div>
    );
  }

  const diskPercent = data.disk?.percent ? parseInt(data.disk.percent, 10) : 0;

  return (
    <div style={s.page}>
      <h1 style={s.heading}>Admin Dashboard</h1>

      <div style={s.grid}>
        {/* API Status */}
        <div style={s.card}>
          <div style={s.cardLabel}>API</div>
          <div style={s.statusRow}>
            <span style={{ ...s.dot, background: data.api?.ok ? '#22c55e' : '#ef4444' }} />
            <span style={s.statusText}>{data.api?.ok ? 'Online' : 'Down'}</span>
          </div>
          <div style={s.detail}>Uptime: {formatUptime(data.api?.uptime_s || 0)}</div>
        </div>

        {/* NAS Status */}
        <div style={s.card}>
          <div style={s.cardLabel}>NAS</div>
          <div style={s.statusRow}>
            <span style={{ ...s.dot, background: data.nas?.connected ? '#22c55e' : '#ef4444' }} />
            <span style={s.statusText}>{data.nas?.connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div style={s.detail}>{data.nas?.assetsRoot}</div>
        </div>

        {/* Disk Usage */}
        <div style={s.card}>
          <div style={s.cardLabel}>Disk Usage</div>
          {data.disk?.error ? (
            <div style={s.detail}>{data.disk.error}</div>
          ) : (
            <>
              <div style={s.barOuter}>
                <div style={{ ...s.barInner, width: `${Math.min(diskPercent, 100)}%` }} />
              </div>
              <div style={s.detail}>
                {formatBytes(data.disk?.used)} / {formatBytes(data.disk?.total)} ({data.disk?.percent})
              </div>
              <div style={s.detail}>{formatBytes(data.disk?.available)} available</div>
            </>
          )}
        </div>

        {/* Users */}
        <div style={s.card}>
          <div style={s.cardLabel}>Users</div>
          <div style={s.bigNumber}>{data.users?.count ?? '—'}</div>
          <div style={s.detail}>registered accounts</div>
        </div>

        {/* Active Shares */}
        <div style={s.card}>
          <div style={s.cardLabel}>Active Shares</div>
          <div style={s.bigNumber}>{data.shares?.active_count ?? '—'}</div>
          <div style={s.detail}>share links</div>
        </div>
      </div>

      {/* User Management */}
      <div style={s.usersSection}>
        <h2 style={s.sectionHeading}>User Management</h2>
        {usersLoading ? (
          <div style={s.detail}>Loading users...</div>
        ) : users.length === 0 ? (
          <div style={s.detail}>No users found.</div>
        ) : (
          <div style={s.usersTable}>
            <div style={s.tableHeader}>
              <span style={{ ...s.tableCell, flex: 2 }}>User</span>
              <span style={{ ...s.tableCell, flex: 1 }}>Role</span>
            </div>
            {users.map(user => (
              <div key={user.id} style={s.tableRow}>
                <div style={{ ...s.tableCell, flex: 2 }}>
                  <div style={s.userName}>{user.display_name || user.email}</div>
                  {user.display_name && <div style={s.userEmail}>{user.email}</div>}
                </div>
                <div style={{ ...s.tableCell, flex: 1 }}>
                  <select
                    value={user.role}
                    onChange={e => handleRoleChange(user.id, e.target.value)}
                    disabled={roleUpdating === user.id}
                    style={{
                      ...s.roleSelect,
                      borderColor: ROLE_COLORS[user.role] || '#64748b',
                      color: ROLE_COLORS[user.role] || '#e2e8f0',
                      opacity: roleUpdating === user.id ? 0.5 : 1,
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', sans-serif",
    padding: '40px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  heading: {
    fontSize: '28px',
    fontWeight: 700,
    marginBottom: '32px',
    color: '#f1f5f9',
  },
  loading: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.4)',
    marginTop: '120px',
  },
  errorCard: {
    textAlign: 'center',
    marginTop: '120px',
  },
  errorTitle: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '8px',
  },
  errorText: {
    fontSize: '15px',
    color: 'rgba(255,255,255,0.5)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '16px',
    width: '100%',
    maxWidth: '900px',
  },
  card: {
    background: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
  },
  cardLabel: {
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: '12px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  detail: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    marginTop: '4px',
  },
  bigNumber: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '4px',
  },
  barOuter: {
    width: '100%',
    height: '8px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.1)',
    marginBottom: '8px',
    overflow: 'hidden',
  },
  barInner: {
    height: '100%',
    borderRadius: '4px',
    background: '#6366f1',
    transition: 'width 0.3s',
  },
  usersSection: {
    width: '100%',
    maxWidth: '900px',
    marginTop: '40px',
  },
  sectionHeading: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: '16px',
  },
  usersTable: {
    background: '#1e293b',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.35)',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  tableCell: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  userName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userEmail: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: '2px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  roleSelect: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'auto',
    maxWidth: '120px',
  },
};
