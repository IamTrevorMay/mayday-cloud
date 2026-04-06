import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authedFetch, authedUrl } from '../lib/supabase';
import * as tus from 'tus-js-client';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
const THUMB_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'mkv', 'webm'];
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';
const WEB_URL = process.env.REACT_APP_WEB_URL || window.location.origin;
const TUS_THRESHOLD = 5 * 1024 * 1024; // 5MB

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileIcon(extension) {
  const ext = (extension || '').toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (['psd', 'ai', 'prproj', 'aep', 'drp', 'fcpx'].includes(ext)) return 'project';
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'file';
}

function hasThumbnail(item) {
  return item.type === 'file' && THUMB_EXTENSIONS.includes((item.extension || '').toLowerCase());
}

// ─── Thumbnail component ───
function Thumbnail({ filePath, size = 80 }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authedUrl(`/api/nas/thumb?path=${encodeURIComponent(filePath)}`)
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [filePath]);

  if (failed || !url) return null;

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: 'cover', borderRadius: size > 40 ? '6px' : '3px', flexShrink: 0 }}
      onError={() => setFailed(true)}
    />
  );
}

export default function Drive() {
  const { user, signOut } = useAuth();
  const [nasStatus, setNasStatus] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [viewMode, setViewMode] = useState('list');
  const [error, setError] = useState(null);

  // Upload state
  const [uploads, setUploads] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);

  // Rename
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // New folder
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Preview URL (authenticated)
  const [previewUrl, setPreviewUrl] = useState(null);

  // Sidebar navigation
  const [activeView, setActiveView] = useState('files');

  // Share links state
  const [shareLinks, setShareLinks] = useState([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [showCreateShare, setShowCreateShare] = useState(null);
  const [shareMode, setShareMode] = useState('upload');
  const [shareExpiry, setShareExpiry] = useState('');
  const [shareMaxUses, setShareMaxUses] = useState('');
  const [createdShareLink, setCreatedShareLink] = useState(null);
  const [copiedLink, setCopiedLink] = useState(null);

  // Trash state
  const [trashItems, setTrashItems] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);

  // ─── Multi-select state ───
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

  // ─── Move dialog state ───
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveItemPaths, setMoveItemPaths] = useState([]);
  const [moveFolders, setMoveFolders] = useState([]);
  const [movePath, setMovePath] = useState('');
  const [moveLoading, setMoveLoading] = useState(false);

  // ─── Favorites state ───
  const [favorites, setFavorites] = useState(new Set());
  const [favoriteItems, setFavoriteItems] = useState([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

  // ─── Settings state ───
  const [storageInfo, setStorageInfo] = useState(null);

  // ─── API Keys state ───
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState(null);

  // Health check
  const checkHealth = useCallback(async () => {
    setNasStatus(null);
    try {
      const data = await authedFetch('/api/nas/health');
      setNasStatus(data.connected === true);
    } catch {
      setNasStatus(false);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  // Fetch listing
  const fetchListing = useCallback(async (dirPath) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ path: dirPath || '', sort: sortBy, order: sortOrder });
      const data = await authedFetch(`/api/nas/list?${params}`);
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder]);

  useEffect(() => {
    if (activeView === 'files') fetchListing(currentPath);
  }, [currentPath, fetchListing, activeView]);

  // ─── Share Links API ───
  const fetchShareLinks = useCallback(async () => {
    setShareLinksLoading(true);
    try {
      const data = await authedFetch('/api/shares');
      setShareLinks(Array.isArray(data) ? data : []);
    } catch {
      setShareLinks([]);
    } finally {
      setShareLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'shared') fetchShareLinks();
  }, [activeView, fetchShareLinks]);

  function openCreateShare(itemPath, itemType) {
    setShowCreateShare({ path: itemPath, type: itemType });
    setShareMode('upload');
    setShareExpiry('');
    setShareMaxUses('');
    setCreatedShareLink(null);
  }

  async function createShareLink() {
    try {
      const body = {
        target_path: showCreateShare.path,
        mode: shareMode,
      };
      if (shareExpiry) {
        const hoursUntil = Math.max(1, Math.round((new Date(shareExpiry) - Date.now()) / 3600000));
        body.expires_in_hours = hoursUntil;
      }
      if (shareMaxUses) body.max_uses = parseInt(shareMaxUses, 10);

      const data = await authedFetch('/api/shares', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCreatedShareLink(`${WEB_URL}/drop/${data.token}`);
    } catch (err) {
      alert('Failed to create share link: ' + err.message);
    }
  }

  async function revokeShareLink(id) {
    if (!window.confirm('Revoke this share link?')) return;
    try {
      await authedFetch(`/api/shares/${id}`, { method: 'DELETE' });
      fetchShareLinks();
    } catch (err) {
      alert('Revoke failed: ' + err.message);
    }
  }

  function copyShareUrl(url) {
    navigator.clipboard.writeText(url);
    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 2000);
  }

  // ─── Trash API ───
  const fetchTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const data = await authedFetch('/api/nas/trash');
      setTrashItems(data.items || []);
    } catch {
      setTrashItems([]);
    } finally {
      setTrashLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'trash') fetchTrash();
  }, [activeView, fetchTrash]);

  async function restoreTrashItem(trashName) {
    try {
      await authedFetch('/api/nas/trash/restore', {
        method: 'POST',
        body: JSON.stringify({ trashName }),
      });
      fetchTrash();
    } catch (err) {
      alert('Restore failed: ' + err.message);
    }
  }

  async function permanentDeleteTrashItem(trashName) {
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    try {
      await authedFetch('/api/nas/trash/delete', {
        method: 'DELETE',
        body: JSON.stringify({ trashName }),
      });
      fetchTrash();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  async function emptyTrash() {
    if (!window.confirm('Permanently delete all items in trash? This cannot be undone.')) return;
    try {
      await authedFetch('/api/nas/trash/empty', { method: 'DELETE' });
      fetchTrash();
    } catch (err) {
      alert('Empty trash failed: ' + err.message);
    }
  }

  // ─── Favorites API ───
  const fetchFavoritePaths = useCallback(async () => {
    try {
      const data = await authedFetch('/api/nas/favorites');
      setFavorites(new Set((data || []).map(f => f.file_path)));
    } catch {
      setFavorites(new Set());
    }
  }, []);

  useEffect(() => { fetchFavoritePaths(); }, [fetchFavoritePaths]);

  const fetchFavoriteItems = useCallback(async () => {
    setFavoritesLoading(true);
    try {
      const data = await authedFetch('/api/nas/favorites');
      setFavoriteItems(data || []);
      setFavorites(new Set((data || []).map(f => f.file_path)));
    } catch {
      setFavoriteItems([]);
    } finally {
      setFavoritesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'favorites') fetchFavoriteItems();
  }, [activeView, fetchFavoriteItems]);

  async function toggleFavorite(filePath) {
    const isFav = favorites.has(filePath);
    // Optimistic update
    setFavorites(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(filePath); else next.add(filePath);
      return next;
    });
    try {
      if (isFav) {
        await authedFetch('/api/nas/favorites', { method: 'DELETE', body: JSON.stringify({ file_path: filePath }) });
      } else {
        await authedFetch('/api/nas/favorites', { method: 'POST', body: JSON.stringify({ file_path: filePath }) });
      }
    } catch {
      // Revert on error
      setFavorites(prev => {
        const next = new Set(prev);
        if (isFav) next.add(filePath); else next.delete(filePath);
        return next;
      });
    }
  }

  // ─── Storage API ───
  async function fetchStorage() {
    try {
      const data = await authedFetch('/api/nas/storage');
      setStorageInfo(data);
    } catch {
      setStorageInfo(null);
    }
  }

  // ─── API Keys API ───
  const fetchApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const data = await authedFetch('/api/keys');
      setApiKeys(Array.isArray(data) ? data : []);
    } catch {
      setApiKeys([]);
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'settings') {
      fetchStorage();
      fetchApiKeys();
    }
  }, [activeView, fetchApiKeys]);

  async function createApiKey() {
    if (!newKeyName.trim()) return;
    try {
      const data = await authedFetch('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName }),
      });
      setCreatedKey(data.raw_key);
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      alert('Failed to create API key: ' + err.message);
    }
  }

  async function revokeApiKey(id) {
    if (!window.confirm('Revoke this API key? This cannot be undone.')) return;
    try {
      await authedFetch(`/api/keys/${id}`, { method: 'DELETE' });
      fetchApiKeys();
    } catch (err) {
      alert('Revoke failed: ' + err.message);
    }
  }

  // ─── Multi-select logic ───
  function toggleSelect(item, index, e) {
    const displayList = searchResults || items;
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          next.add(displayList[i].path);
        }
      } else if (e.metaKey || e.ctrlKey) {
        if (next.has(item.path)) next.delete(item.path); else next.add(item.path);
      } else {
        if (next.has(item.path) && next.size === 1) next.delete(item.path); else {
          next.clear();
          next.add(item.path);
        }
      }
      return next;
    });
    setLastClickedIndex(index);
  }

  function selectAll() {
    const displayList = searchResults || items;
    if (selectedItems.size === displayList.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(displayList.map(it => it.path)));
    }
  }

  function clearSelection() {
    setSelectedItems(new Set());
    setLastClickedIndex(null);
  }

  // ─── Move dialog logic ───
  function openMoveDialog(paths) {
    setMoveItemPaths(paths);
    setMovePath('');
    setShowMoveDialog(true);
    fetchMoveFolders('');
  }

  async function fetchMoveFolders(dirPath) {
    try {
      const params = new URLSearchParams({ path: dirPath || '' });
      const data = await authedFetch(`/api/nas/list?${params}`);
      setMoveFolders((data.items || []).filter(i => i.type === 'directory'));
      setMovePath(dirPath);
    } catch {
      setMoveFolders([]);
    }
  }

  async function executeMove() {
    setMoveLoading(true);
    try {
      for (const itemPath of moveItemPaths) {
        await authedFetch('/api/nas/move', {
          method: 'POST',
          body: JSON.stringify({ path: itemPath, destination: movePath || '' }),
        });
      }
      setShowMoveDialog(false);
      clearSelection();
      fetchListing(currentPath);
    } catch (err) {
      alert('Move failed: ' + err.message);
    } finally {
      setMoveLoading(false);
    }
  }

  // ─── Bulk operations ───
  async function handleBulkDelete() {
    const count = selectedItems.size;
    if (!window.confirm(`Move ${count} item${count > 1 ? 's' : ''} to trash?`)) return;
    try {
      for (const itemPath of selectedItems) {
        await authedFetch('/api/nas/delete', {
          method: 'DELETE',
          body: JSON.stringify({ path: itemPath }),
        });
      }
      clearSelection();
      fetchListing(currentPath);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  // Search
  async function handleSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: searchQuery, dataset: currentPath.split('/')[0] || '' });
      const data = await authedFetch(`/api/nas/search?${params}`);
      setSearchResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
  }

  function navigateTo(itemPath) {
    setSelectedFile(null);
    clearSearch();
    clearSelection();
    setCurrentPath(itemPath);
  }

  function goBack() {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length <= 1) setCurrentPath('');
    else { parts.pop(); setCurrentPath(parts.join('/')); }
    setSelectedFile(null);
    clearSearch();
    clearSelection();
  }

  function getBreadcrumbs() {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }

  function handleNavigate(view) {
    setActiveView(view);
    setSelectedFile(null);
    clearSearch();
    clearSelection();
  }

  // ─── Upload (tus for large files, multer for small) ───
  async function handleUploadFiles(files) {
    const { supabase } = await import('../lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const fileList = Array.from(files);
    for (const file of fileList) {
      const id = Date.now() + '_' + file.name;

      if (file.size > TUS_THRESHOLD) {
        // Use tus for large files
        setUploads(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);

        const upload = new tus.Upload(file, {
          endpoint: `${API_URL}/api/nas/tus`,
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 5 * 1024 * 1024,
          metadata: {
            filename: file.name,
            targetPath: currentPath,
            filetype: file.type,
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          onProgress(bytesUploaded, bytesTotal) {
            const pct = Math.round((bytesUploaded / bytesTotal) * 100);
            setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: pct } : u));
          },
          onSuccess() {
            setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: 100, status: 'done' } : u));
            fetchListing(currentPath);
            setTimeout(() => setUploads(prev => prev.filter(u => u.id !== id)), 3000);
          },
          onError(err) {
            setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: err.message } : u));
          },
        });

        upload.start();
      } else {
        // Use multer for small files
        setUploads(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);

        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('path', currentPath);

          await authedFetch('/api/nas/upload', { method: 'POST', body: formData });
          setUploads(prev => prev.map(u => u.id === id ? { ...u, progress: 100, status: 'done' } : u));
        } catch (err) {
          setUploads(prev => prev.map(u => u.id === id ? { ...u, status: 'error', error: err.message } : u));
        }
      }
    }
    // Refresh for small files that completed synchronously
    fetchListing(currentPath);
    setTimeout(() => setUploads(prev => prev.filter(u => u.status === 'done' ? false : true)), 3000);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files);
  }

  function handleDragOver(e) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }

  // ─── Context menu actions ───
  function handleContextMenu(e, item) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }

  useEffect(() => {
    function close() { setContextMenu(null); }
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  async function handleDelete(item) {
    if (!window.confirm(`Move "${item.name}" to trash?`)) return;
    try {
      await authedFetch('/api/nas/delete', {
        method: 'DELETE',
        body: JSON.stringify({ path: item.path }),
      });
      fetchListing(currentPath);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  function startRename(item) {
    setRenaming(item);
    setRenameValue(item.name);
  }

  async function submitRename() {
    if (!renaming || !renameValue.trim() || renameValue === renaming.name) {
      setRenaming(null);
      return;
    }
    try {
      await authedFetch('/api/nas/rename', {
        method: 'POST',
        body: JSON.stringify({ path: renaming.path, newName: renameValue }),
      });
      setRenaming(null);
      fetchListing(currentPath);
    } catch (err) {
      alert('Rename failed: ' + err.message);
    }
  }

  async function handleNewFolder() {
    if (!newFolderName.trim()) { setCreatingFolder(false); return; }
    try {
      const folderPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
      await authedFetch('/api/nas/mkdir', {
        method: 'POST',
        body: JSON.stringify({ path: folderPath }),
      });
      setCreatingFolder(false);
      setNewFolderName('');
      fetchListing(currentPath);
    } catch (err) {
      alert('Create folder failed: ' + err.message);
    }
  }

  async function handleDownload(filePath) {
    const { supabase } = await import('../lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const url = `${API_URL}/api/nas/download?path=${encodeURIComponent(filePath)}&token=${session.access_token}`;
    window.open(url, '_blank');
  }

  // Generate authenticated preview URL when a file is selected
  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(null); return; }
    const ext = (selectedFile.extension || '').toLowerCase();
    const needsPreview = IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext);
    if (!needsPreview) { setPreviewUrl(null); return; }
    let cancelled = false;
    authedUrl(`/api/nas/stream?path=${encodeURIComponent(selectedFile.path)}`)
      .then((url) => { if (!cancelled) setPreviewUrl(url); })
      .catch(() => { if (!cancelled) setPreviewUrl(null); });
    return () => { cancelled = true; };
  }, [selectedFile]);

  // ─── File Detail View ───
  if (selectedFile) {
    const isImage = IMAGE_EXTENSIONS.includes((selectedFile.extension || '').toLowerCase());
    const isVideo = VIDEO_EXTENSIONS.includes((selectedFile.extension || '').toLowerCase());
    const isAudio = AUDIO_EXTENSIONS.includes((selectedFile.extension || '').toLowerCase());

    return (
      <div style={s.layout}>
        <Sidebar user={user} activeView={activeView} onNavigate={handleNavigate} />
        <div style={s.main}>
          <div style={s.header}>
            <button onClick={() => setSelectedFile(null)} style={s.backBtn}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 2L4 8l6 6" /></svg>
              Back
            </button>
            <h1 style={s.title}>{selectedFile.name}</h1>
          </div>
          <div style={s.detailCard}>
            {isImage && previewUrl && (
              <div style={s.previewArea}>
                <img
                  src={previewUrl}
                  alt={selectedFile.name}
                  style={s.previewImg}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            )}
            {isVideo && previewUrl && (
              <div style={s.previewArea}>
                <video
                  src={previewUrl}
                  controls
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px' }}
                />
              </div>
            )}
            {isAudio && previewUrl && (
              <div style={s.previewArea}>
                <audio
                  src={previewUrl}
                  controls
                  style={{ width: '100%' }}
                />
              </div>
            )}
            <div style={s.detailMeta}>
              <div style={s.detailRow}><span style={s.detailLabel}>Name</span><span>{selectedFile.name}</span></div>
              <div style={s.detailRow}><span style={s.detailLabel}>Path</span><span style={{ opacity: 0.6, fontSize: '13px' }}>/{selectedFile.path}</span></div>
              <div style={s.detailRow}><span style={s.detailLabel}>Size</span><span>{formatBytes(selectedFile.size)}</span></div>
              <div style={s.detailRow}><span style={s.detailLabel}>Modified</span><span>{formatDate(selectedFile.modified)}</span></div>
              {selectedFile.extension && (
                <div style={s.detailRow}><span style={s.detailLabel}>Type</span><span>.{selectedFile.extension.toUpperCase()}</span></div>
              )}
            </div>
            <button onClick={() => handleDownload(selectedFile.path)} style={s.downloadBtn}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v9M4 8l4 4 4-4M2 13h12" /></svg>
              Download File
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main Layout ───
  const breadcrumbs = getBreadcrumbs();
  const displayItems = searchResults || items;
  const hasSelection = selectedItems.size > 0;

  return (
    <div style={s.layout}>
      <Sidebar user={user} activeView={activeView} onNavigate={handleNavigate} />
      <div
        style={{ ...s.main, ...(dragOver && activeView === 'files' ? { background: 'rgba(99,102,241,0.05)' } : {}) }}
        onDrop={activeView === 'files' ? handleDrop : undefined}
        onDragOver={activeView === 'files' ? handleDragOver : undefined}
        onDragLeave={activeView === 'files' ? handleDragLeave : undefined}
      >
        {/* Files View */}
        {activeView === 'files' && (
          <>
            {/* Header */}
            <div style={s.header}>
              {currentPath && (
                <button onClick={goBack} style={s.backBtn}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 2L4 8l6 6" /></svg>
                </button>
              )}
              <div style={s.breadcrumbs}>
                <button onClick={() => { setCurrentPath(''); clearSearch(); clearSelection(); }} style={{ ...s.breadcrumbBtn, ...(breadcrumbs.length === 0 ? { color: '#e2e8f0', fontWeight: 600 } : {}) }}>
                  My Files
                </button>
                {breadcrumbs.map((seg, i) => (
                  <React.Fragment key={i}>
                    <span style={s.breadcrumbSep}>/</span>
                    <button
                      onClick={() => { navigateTo(breadcrumbs.slice(0, i + 1).join('/')); }}
                      style={{ ...s.breadcrumbBtn, ...(i === breadcrumbs.length - 1 ? { color: '#e2e8f0', fontWeight: 600 } : {}) }}
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div style={s.headerRight}>
                <div style={s.statusDot}>
                  <span style={{ ...s.dot, background: nasStatus === null ? '#f59e0b' : nasStatus ? '#22c55e' : '#ef4444' }} />
                  <span style={s.statusText}>
                    {nasStatus === null ? 'Checking...' : nasStatus ? 'Connected' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            {/* Toolbar — selection or normal */}
            {hasSelection ? (
              <div style={s.selectionToolbar}>
                <span style={s.selectionCount}>{selectedItems.size} selected</span>
                <button onClick={clearSelection} style={s.smallBtn}>Clear</button>
                <button onClick={() => openMoveDialog(Array.from(selectedItems))} style={s.smallBtn}>Move to...</button>
                <button onClick={handleBulkDelete} style={{ ...s.smallBtn, color: '#fca5a5', borderColor: 'rgba(252,165,165,0.2)' }}>Delete</button>
              </div>
            ) : (
              <div style={s.toolbar}>
                <form onSubmit={handleSearch} style={s.searchForm}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search files..."
                    style={s.searchInput}
                  />
                  {searchResults && <button type="button" onClick={clearSearch} style={s.clearSearchBtn}>Clear</button>}
                </form>
                <button onClick={() => setCreatingFolder(true)} style={s.actionBtn} title="New folder">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3h4l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M8 7v4M6 9h4" /></svg>
                </button>
                <button onClick={() => fileInputRef.current?.click()} style={s.uploadBtn}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 12V3M4 7l4-4 4 4" /><path d="M2 13h12" /></svg>
                  Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files.length) handleUploadFiles(e.target.files); e.target.value = ''; }}
                />
                <div style={s.viewControls}>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={s.sortSelect}>
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                    <option value="modified">Modified</option>
                  </select>
                  <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} style={s.iconBtn}>
                    {sortOrder === 'asc' ? '\u2191' : '\u2193'}
                  </button>
                  <button onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')} style={s.iconBtn}>
                    {viewMode === 'grid' ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1" /><rect x="1" y="7" width="14" height="3" rx="1" /><rect x="1" y="12" width="14" height="3" rx="1" /></svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* New folder input */}
            {creatingFolder && (
              <div style={s.newFolderRow}>
                <FileIcon type="folder" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleNewFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                  onBlur={handleNewFolder}
                  placeholder="Folder name..."
                  style={s.renameInput}
                />
              </div>
            )}

            {/* Upload progress */}
            {uploads.length > 0 && (
              <div style={s.uploadsBar}>
                {uploads.map(u => (
                  <div key={u.id} style={s.uploadItem}>
                    <span style={s.uploadName}>{u.name}</span>
                    <span style={{ ...s.uploadStatus, color: u.status === 'error' ? '#fca5a5' : u.status === 'done' ? '#86efac' : '#a5b4fc' }}>
                      {u.status === 'uploading' ? `Uploading... ${u.progress}%` : u.status === 'done' ? 'Done' : u.error || 'Error'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Drag overlay */}
            {dragOver && (
              <div style={s.dragOverlay}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#a5b4fc' }}>Drop files to upload</div>
              </div>
            )}

            {error && <div style={s.errorMsg}>{error}</div>}

            {/* Content */}
            {loading ? (
              <div style={s.emptyMsg}>Loading...</div>
            ) : displayItems.length === 0 ? (
              <div style={s.emptyState}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', marginTop: '12px' }}>
                  {searchResults ? 'No results found.' : 'This folder is empty.'}
                </div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>
                  Drag files here or click Upload
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div style={s.fileGrid}>
                {displayItems.map((item, i) => {
                  const isSelected = selectedItems.has(item.path);
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        if (hasSelection) { toggleSelect(item, i, {}); return; }
                        if (item.type === 'directory') navigateTo(item.path); else setSelectedFile(item);
                      }}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      style={{ ...s.fileCard, ...(isSelected ? s.fileCardSelected : {}), position: 'relative' }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => { e.stopPropagation(); toggleSelect(item, i, e); }}
                        style={{ ...s.checkbox, position: 'absolute', top: '8px', left: '8px' }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(item.path); }}
                        style={{ ...s.starBtn, ...(favorites.has(item.path) ? s.starBtnActive : {}), position: 'absolute', top: '6px', right: '6px' }}
                      >
                        {favorites.has(item.path) ? '\u2605' : '\u2606'}
                      </button>
                      {hasThumbnail(item) ? (
                        <Thumbnail filePath={item.path} size={80} />
                      ) : (
                        <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
                      )}
                      {renaming?.path === item.path ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null); }}
                          onBlur={submitRename}
                          onClick={e => e.stopPropagation()}
                          style={s.renameInput}
                        />
                      ) : (
                        <div style={s.fileName}>{item.name}</div>
                      )}
                      <div style={s.fileMeta}>
                        {item.type === 'directory' ? 'Folder' : formatBytes(item.size)}
                        {item.modified ? ` · ${formatDate(item.modified)}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={s.fileList}>
                <div style={s.listHeader}>
                  <input
                    type="checkbox"
                    checked={displayItems.length > 0 && selectedItems.size === displayItems.length}
                    onChange={selectAll}
                    style={s.checkbox}
                  />
                  <span style={{ width: '28px' }} />
                  <span style={{ ...s.listHeaderCell, flex: 1 }}>Name</span>
                  <span style={{ ...s.listHeaderCell, width: '32px' }} />
                  <span style={{ ...s.listHeaderCell, width: '80px', textAlign: 'right' }}>Size</span>
                  <span style={{ ...s.listHeaderCell, width: '120px', textAlign: 'right' }}>Modified</span>
                </div>
                {displayItems.map((item, i) => {
                  const isSelected = selectedItems.has(item.path);
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        if (hasSelection) { toggleSelect(item, i, {}); return; }
                        if (item.type === 'directory') navigateTo(item.path); else setSelectedFile(item);
                      }}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      style={{ ...s.fileListRow, ...(isSelected ? s.fileListRowSelected : {}) }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => { e.stopPropagation(); toggleSelect(item, i, e); }}
                        style={s.checkbox}
                      />
                      {hasThumbnail(item) ? (
                        <Thumbnail filePath={item.path} size={20} />
                      ) : (
                        <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
                      )}
                      {renaming?.path === item.path ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null); }}
                          onBlur={submitRename}
                          onClick={e => e.stopPropagation()}
                          style={{ ...s.renameInput, flex: 1 }}
                        />
                      ) : (
                        <span style={s.fileListName}>{item.name}</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(item.path); }}
                        style={{ ...s.starBtn, ...(favorites.has(item.path) ? s.starBtnActive : {}) }}
                      >
                        {favorites.has(item.path) ? '\u2605' : '\u2606'}
                      </button>
                      <span style={s.fileListSize}>{item.type === 'directory' ? '—' : formatBytes(item.size)}</span>
                      <span style={s.fileListDate}>{formatDate(item.modified)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Context menu */}
            {contextMenu && (
              <div style={{ ...s.contextMenu, left: contextMenu.x, top: contextMenu.y }}>
                {contextMenu.item.type === 'file' && (
                  <button style={s.contextMenuItem} onClick={() => handleDownload(contextMenu.item.path)}>Download</button>
                )}
                <button style={s.contextMenuItem} onClick={() => openCreateShare(contextMenu.item.path, contextMenu.item.type)}>Share</button>
                <button style={s.contextMenuItem} onClick={() => startRename(contextMenu.item)}>Rename</button>
                <button style={s.contextMenuItem} onClick={() => openMoveDialog([contextMenu.item.path])}>Move to...</button>
                <button style={s.contextMenuItem} onClick={() => toggleFavorite(contextMenu.item.path)}>
                  {favorites.has(contextMenu.item.path) ? 'Unfavorite' : 'Favorite'}
                </button>
                <button style={{ ...s.contextMenuItem, color: '#fca5a5' }} onClick={() => handleDelete(contextMenu.item)}>Delete</button>
              </div>
            )}
          </>
        )}

        {/* Favorites View */}
        {activeView === 'favorites' && (
          <FavoritesView
            items={favoriteItems}
            loading={favoritesLoading}
            onToggleFavorite={toggleFavorite}
            onNavigateToFile={(filePath) => {
              const parts = filePath.split('/');
              parts.pop();
              setActiveView('files');
              setCurrentPath(parts.join('/'));
            }}
          />
        )}

        {/* Shared Links View */}
        {activeView === 'shared' && (
          <SharedLinksView
            links={shareLinks}
            loading={shareLinksLoading}
            onRevoke={revokeShareLink}
            onCopy={copyShareUrl}
            copiedLink={copiedLink}
          />
        )}

        {/* Trash View */}
        {activeView === 'trash' && (
          <TrashView
            items={trashItems}
            loading={trashLoading}
            onRestore={restoreTrashItem}
            onDelete={permanentDeleteTrashItem}
            onEmpty={emptyTrash}
          />
        )}

        {/* Settings View */}
        {activeView === 'settings' && (
          <SettingsView
            user={user}
            storageInfo={storageInfo}
            signOut={signOut}
            apiKeys={apiKeys}
            apiKeysLoading={apiKeysLoading}
            showCreateKey={showCreateKey}
            setShowCreateKey={setShowCreateKey}
            newKeyName={newKeyName}
            setNewKeyName={setNewKeyName}
            createdKey={createdKey}
            setCreatedKey={setCreatedKey}
            onCreateKey={createApiKey}
            onRevokeKey={revokeApiKey}
          />
        )}
      </div>

      {/* Create Share Dialog */}
      {showCreateShare && (
        <div style={s.dialogOverlay} onClick={() => { setShowCreateShare(null); setCreatedShareLink(null); }}>
          <div style={s.dialogCard} onClick={e => e.stopPropagation()}>
            <div style={s.dialogTitle}>Create Share Link</div>
            <div style={s.dialogSubtitle}>/{showCreateShare.path}</div>

            {!createdShareLink ? (
              <>
                <div style={s.dialogField}>
                  <label style={s.dialogLabel}>Mode</label>
                  <select value={shareMode} onChange={e => setShareMode(e.target.value)} style={s.dialogSelect}>
                    <option value="upload">Upload only</option>
                    <option value="download">Download only</option>
                    <option value="both">Upload & Download</option>
                  </select>
                </div>
                <div style={s.dialogField}>
                  <label style={s.dialogLabel}>Expires (optional)</label>
                  <input
                    type="datetime-local"
                    value={shareExpiry}
                    onChange={e => setShareExpiry(e.target.value)}
                    style={s.dialogInput}
                  />
                </div>
                <div style={s.dialogField}>
                  <label style={s.dialogLabel}>Max uses (optional)</label>
                  <input
                    type="number"
                    min="1"
                    value={shareMaxUses}
                    onChange={e => setShareMaxUses(e.target.value)}
                    placeholder="Unlimited"
                    style={s.dialogInput}
                  />
                </div>
                <div style={s.dialogActions}>
                  <button onClick={() => { setShowCreateShare(null); setCreatedShareLink(null); }} style={s.dialogCancelBtn}>Cancel</button>
                  <button onClick={createShareLink} style={s.dialogConfirmBtn}>Create Link</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ ...s.dialogField, marginTop: '8px' }}>
                  <label style={s.dialogLabel}>Share URL</label>
                  <div style={s.linkCopyRow}>
                    <input
                      readOnly
                      value={createdShareLink}
                      style={s.linkCopyInput}
                      onFocus={e => e.target.select()}
                    />
                    <button onClick={() => copyShareUrl(createdShareLink)} style={s.linkCopyBtn}>
                      {copiedLink === createdShareLink ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div style={s.dialogActions}>
                  <button onClick={() => { setShowCreateShare(null); setCreatedShareLink(null); }} style={s.dialogConfirmBtn}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Move Dialog */}
      {showMoveDialog && (
        <div style={s.dialogOverlay} onClick={() => setShowMoveDialog(false)}>
          <div style={{ ...s.dialogCard, maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div style={s.dialogTitle}>Move {moveItemPaths.length} item{moveItemPaths.length > 1 ? 's' : ''}</div>
            <div style={s.dialogSubtitle}>Select destination folder</div>

            {/* Move breadcrumbs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => fetchMoveFolders('')}
                style={{ ...s.breadcrumbBtn, ...(movePath === '' ? { color: '#e2e8f0', fontWeight: 600 } : {}) }}
              >
                Root
              </button>
              {movePath && movePath.split('/').filter(Boolean).map((seg, i, arr) => (
                <React.Fragment key={i}>
                  <span style={s.breadcrumbSep}>/</span>
                  <button
                    onClick={() => fetchMoveFolders(arr.slice(0, i + 1).join('/'))}
                    style={{ ...s.breadcrumbBtn, ...(i === arr.length - 1 ? { color: '#e2e8f0', fontWeight: 600 } : {}) }}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Folder list */}
            <div style={{ maxHeight: '240px', overflow: 'auto', marginBottom: '16px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
              {moveFolders.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>No subfolders</div>
              ) : (
                moveFolders.map((folder, i) => (
                  <button
                    key={i}
                    onClick={() => fetchMoveFolders(folder.path)}
                    style={{ ...s.fileListRow, borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <FileIcon type="folder" />
                    <span style={s.fileListName}>{folder.name}</span>
                  </button>
                ))
              )}
            </div>

            <div style={s.dialogActions}>
              <button onClick={() => setShowMoveDialog(false)} style={s.dialogCancelBtn}>Cancel</button>
              <button onClick={executeMove} disabled={moveLoading} style={s.dialogConfirmBtn}>
                {moveLoading ? 'Moving...' : 'Move Here'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Favorites View ───
function FavoritesView({ items, loading, onToggleFavorite, onNavigateToFile }) {
  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Favorites</h1>
      </div>
      {loading ? (
        <div style={s.emptyMsg}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={s.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', marginTop: '12px' }}>
            No favorites yet.
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>
            Click the star on any file to add it here.
          </div>
        </div>
      ) : (
        <div style={s.fileList}>
          <div style={s.listHeader}>
            <span style={{ width: '28px' }} />
            <span style={{ ...s.listHeaderCell, flex: 1 }}>Name</span>
            <span style={{ ...s.listHeaderCell, width: '80px', textAlign: 'right' }}>Size</span>
            <span style={{ ...s.listHeaderCell, width: '120px', textAlign: 'right' }}>Modified</span>
            <span style={{ ...s.listHeaderCell, width: '80px', textAlign: 'right' }}>Actions</span>
          </div>
          {items.map(item => (
            <div
              key={item.id}
              style={{ ...s.fileListRow, ...(item.missing ? { opacity: 0.4 } : {}) }}
              onClick={() => { if (!item.missing) onNavigateToFile(item.file_path); }}
            >
              <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
              <span style={s.fileListName}>{item.name}</span>
              <span style={s.fileListSize}>{item.missing ? 'Missing' : item.type === 'directory' ? '—' : formatBytes(item.size)}</span>
              <span style={s.fileListDate}>{formatDate(item.modified)}</span>
              <span style={{ width: '80px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.file_path); }}
                  style={{ ...s.starBtn, ...s.starBtnActive }}
                >
                  {'\u2605'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared Links View ───
function SharedLinksView({ links, loading, onRevoke, onCopy, copiedLink }) {
  const WEB = process.env.REACT_APP_WEB_URL || window.location.origin;
  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Shared Links</h1>
      </div>
      {loading ? (
        <div style={s.emptyMsg}>Loading...</div>
      ) : links.length === 0 ? (
        <div style={s.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', marginTop: '12px' }}>
            No share links yet.
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.2)', marginTop: '4px' }}>
            Right-click a file or folder and select "Share" to create one.
          </div>
        </div>
      ) : (
        <div style={s.fileList}>
          <div style={s.listHeader}>
            <span style={{ ...s.listHeaderCell, flex: 1 }}>Path</span>
            <span style={{ ...s.listHeaderCell, width: '80px' }}>Mode</span>
            <span style={{ ...s.listHeaderCell, width: '70px', textAlign: 'right' }}>Uses</span>
            <span style={{ ...s.listHeaderCell, width: '100px', textAlign: 'right' }}>Expires</span>
            <span style={{ ...s.listHeaderCell, width: '120px', textAlign: 'right' }}>Actions</span>
          </div>
          {links.map(link => {
            const url = `${WEB}/drop/${link.token}`;
            return (
              <div key={link.id} style={s.fileListRow}>
                <span style={s.fileListName}>/{link.target_path}</span>
                <span style={{ width: '80px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                  {link.mode}
                </span>
                <span style={{ width: '70px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', textAlign: 'right' }}>
                  {link.used_count}{link.max_uses ? `/${link.max_uses}` : ''}
                </span>
                <span style={s.fileListDate}>
                  {link.expires_at ? formatDate(link.expires_at) : 'Never'}
                </span>
                <span style={{ width: '120px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button onClick={() => onCopy(url)} style={s.smallBtn}>
                    {copiedLink === url ? 'Copied!' : 'Copy'}
                  </button>
                  <button onClick={() => onRevoke(link.id)} style={{ ...s.smallBtn, color: '#fca5a5', borderColor: 'rgba(252,165,165,0.2)' }}>
                    Revoke
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Trash View ───
function TrashView({ items, loading, onRestore, onDelete, onEmpty }) {
  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Trash</h1>
        <div style={s.headerRight}>
          {items.length > 0 && (
            <button onClick={onEmpty} style={{ ...s.smallBtn, color: '#fca5a5', borderColor: 'rgba(252,165,165,0.2)' }}>
              Empty Trash
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div style={s.emptyMsg}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={s.emptyState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
          <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', marginTop: '12px' }}>
            Trash is empty.
          </div>
        </div>
      ) : (
        <div style={s.fileList}>
          <div style={s.listHeader}>
            <span style={{ width: '28px' }} />
            <span style={{ ...s.listHeaderCell, flex: 1 }}>Name</span>
            <span style={{ ...s.listHeaderCell, width: '80px', textAlign: 'right' }}>Size</span>
            <span style={{ ...s.listHeaderCell, width: '120px', textAlign: 'right' }}>Deleted</span>
            <span style={{ ...s.listHeaderCell, width: '130px', textAlign: 'right' }}>Actions</span>
          </div>
          {items.map(item => (
            <div key={item.trashName} style={s.fileListRow}>
              <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
              <span style={s.fileListName}>{item.originalName}</span>
              <span style={s.fileListSize}>{item.type === 'directory' ? '—' : formatBytes(item.size)}</span>
              <span style={s.fileListDate}>{formatDate(item.deletedAt)}</span>
              <span style={{ width: '130px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => onRestore(item.trashName)} style={s.smallBtn}>Restore</button>
                <button onClick={() => onDelete(item.trashName)} style={{ ...s.smallBtn, color: '#fca5a5', borderColor: 'rgba(252,165,165,0.2)' }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings View ───
function SettingsView({ user, storageInfo, signOut, apiKeys, apiKeysLoading, showCreateKey, setShowCreateKey, newKeyName, setNewKeyName, createdKey, setCreatedKey, onCreateKey, onRevokeKey }) {
  const [copiedKey, setCopiedKey] = useState(null);
  const percentColor = !storageInfo ? '#6366f1'
    : storageInfo.percent >= 90 ? '#ef4444'
    : storageInfo.percent >= 70 ? '#f59e0b'
    : '#6366f1';

  function copyKey(key) {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Settings</h1>
      </div>
      <div style={{ ...s.detailCard, maxWidth: '600px' }}>
        <div style={s.detailMeta}>
          <div style={s.detailRow}><span style={s.detailLabel}>Email</span><span>{user?.email}</span></div>
          <div style={s.detailRow}><span style={s.detailLabel}>Joined</span><span>{user?.created_at ? formatDate(user.created_at) : '—'}</span></div>
        </div>

        {/* Storage bar */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Storage</span>
            {storageInfo && (
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                {formatBytes(storageInfo.used)} of {formatBytes(storageInfo.total)} ({storageInfo.percent}%)
              </span>
            )}
          </div>
          <div style={{ height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              borderRadius: '4px',
              background: percentColor,
              width: storageInfo ? `${storageInfo.percent}%` : '0%',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* API Keys Section */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Keys</span>
            <button onClick={() => { setShowCreateKey(true); setCreatedKey(null); }} style={s.smallBtn}>Create Key</button>
          </div>

          {/* Create key form */}
          {showCreateKey && (
            <div style={{ marginBottom: '12px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {!createdKey ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    autoFocus
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onCreateKey(); if (e.key === 'Escape') setShowCreateKey(false); }}
                    placeholder="Key name (e.g. CI/CD)"
                    style={{ ...s.dialogInput, flex: 1 }}
                  />
                  <button onClick={onCreateKey} style={s.dialogConfirmBtn}>Create</button>
                  <button onClick={() => setShowCreateKey(false)} style={s.dialogCancelBtn}>Cancel</button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px', fontWeight: 500 }}>
                    Copy this key now — you won't be able to see it again.
                  </div>
                  <div style={s.linkCopyRow}>
                    <input readOnly value={createdKey} style={s.linkCopyInput} onFocus={e => e.target.select()} />
                    <button onClick={() => copyKey(createdKey)} style={s.linkCopyBtn}>
                      {copiedKey === createdKey ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ marginTop: '8px', textAlign: 'right' }}>
                    <button onClick={() => { setShowCreateKey(false); setCreatedKey(null); }} style={s.smallBtn}>Done</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Keys table */}
          {apiKeysLoading ? (
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>Loading...</div>
          ) : apiKeys.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>No API keys yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {apiKeys.map(key => {
                const isRevoked = !!key.revoked_at;
                return (
                  <div key={key.id} style={{ ...s.fileListRow, ...(isRevoked ? { opacity: 0.4 } : {}) }}>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', width: '80px', fontFamily: 'monospace', flexShrink: 0 }}>{key.key_prefix}...</span>
                    <span style={{ ...s.fileListName, ...(isRevoked ? { textDecoration: 'line-through' } : {}) }}>{key.name}</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', width: '80px', textAlign: 'right', flexShrink: 0 }}>{formatDate(key.created_at)}</span>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', width: '80px', textAlign: 'right', flexShrink: 0 }}>{key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</span>
                    <span style={{ width: '70px', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                      {isRevoked ? (
                        <span style={{ fontSize: '11px', color: '#fca5a5' }}>Revoked</span>
                      ) : (
                        <button onClick={() => onRevokeKey(key.id)} style={{ ...s.smallBtn, color: '#fca5a5', borderColor: 'rgba(252,165,165,0.2)' }}>Revoke</button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={signOut} style={{ ...s.dialogCancelBtn, width: '100%', textAlign: 'center' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar ───
function Sidebar({ user, activeView, onNavigate }) {
  const navItems = [
    { key: 'files', label: 'My Files', icon: 'M3 3h7l2 2h6a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z' },
    { key: 'favorites', label: 'Favorites', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z' },
    { key: 'shared', label: 'Shared Links', icon: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
    { key: 'trash', label: 'Trash', icon: 'M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2' },
  ];

  return (
    <div style={s.sidebar}>
      <div style={s.sidebarLogo}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#e2e8f0' }}>Mayday Cloud</span>
      </div>
      <nav style={s.sidebarNav}>
        {navItems.map(item => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            style={{ ...s.sidebarItem, ...(activeView === item.key ? s.sidebarItemActive : {}) }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            {item.label}
          </button>
        ))}
      </nav>
      {/* Settings pinned above footer */}
      <div style={{ marginTop: 'auto', padding: '0 8px' }}>
        <button
          onClick={() => onNavigate('settings')}
          style={{ ...s.sidebarItem, ...(activeView === 'settings' ? s.sidebarItemActive : {}), marginBottom: '8px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
          Settings
        </button>
      </div>
      <div style={s.sidebarFooter}>
        <div style={s.userInfo}>
          <div style={s.userAvatar}>{(user?.email || '?')[0].toUpperCase()}</div>
          <span style={s.userEmail}>{user?.email}</span>
        </div>
      </div>
    </div>
  );
}

// ─── FileIcon ───
function FileIcon({ type }) {
  const colors = { folder: '#f59e0b', video: '#6366f1', audio: '#8b5cf6', image: '#ec4899', project: '#22c55e', doc: '#3b82f6', archive: '#64748b', file: '#94a3b8' };
  const paths = {
    folder: 'M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z',
    video: 'M4 4h10a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM8 8l4 2.5L8 13V8z',
    audio: 'M9 2v14M5 6v8M1 9v2M13 6v8M17 9v2',
    image: 'M2 4h14a2 2 0 012 2v8a2 2 0 01-2 2H2V6a2 2 0 012-2zM5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    doc: 'M4 2h8l4 4v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM12 2v4h4M6 9h6M6 12h4',
    archive: 'M4 2h10a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM8 6v4M6 8h4',
    file: 'M4 2h8l4 4v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM12 2v4h4',
    project: 'M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z',
  };
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={colors[type] || colors.file} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={paths[type] || paths.file} />
    </svg>
  );
}

// ─── Styles ───
const s = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
  },
  // Sidebar
  sidebar: {
    width: '240px',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)',
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 0',
    flexShrink: 0,
  },
  sidebarLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 20px 20px',
  },
  sidebarNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '0 8px',
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    width: '100%',
  },
  sidebarItemActive: {
    background: 'rgba(99,102,241,0.1)',
    color: '#a5b4fc',
  },
  sidebarFooter: {
    padding: '12px 16px 8px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  userAvatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: '#6366f1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
    flexShrink: 0,
  },
  userEmail: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Main content
  main: {
    flex: 1,
    padding: '24px 32px',
    position: 'relative',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
  },
  headerRight: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
  },
  breadcrumbBtn: {
    padding: '2px 4px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '15px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  breadcrumbSep: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: '14px',
  },
  statusDot: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  dot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
  },
  // Toolbar
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    marginTop: '8px',
  },
  selectionToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
    marginTop: '8px',
    padding: '8px 14px',
    borderRadius: '10px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.15)',
  },
  selectionCount: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#a5b4fc',
    marginRight: 'auto',
  },
  searchForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    padding: '0 12px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
  },
  searchInput: {
    flex: 1,
    padding: '9px 0',
    border: 'none',
    background: 'transparent',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  clearSearchBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  actionBtn: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  uploadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    border: 'none',
    borderRadius: '8px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  viewControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  sortSelect: {
    padding: '8px 8px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    color: '#e2e8f0',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  iconBtn: {
    padding: '8px 8px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
  },
  smallBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  // Upload bar
  uploadsBar: {
    marginBottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  uploadItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 14px',
    borderRadius: '8px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.15)',
    fontSize: '13px',
  },
  uploadName: {
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '300px',
  },
  uploadStatus: {
    fontSize: '12px',
    fontWeight: 500,
    flexShrink: 0,
  },
  // Drag overlay
  dragOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15,15,26,0.85)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    zIndex: 10,
    borderRadius: '12px',
    border: '2px dashed rgba(99,102,241,0.4)',
  },
  // New folder
  newFolderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px',
    marginBottom: '8px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(99,102,241,0.2)',
  },
  renameInput: {
    padding: '4px 8px',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    background: 'rgba(0,0,0,0.3)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  // Checkbox
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: '#6366f1',
    cursor: 'pointer',
    flexShrink: 0,
  },
  // Star
  starBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: 'rgba(255,255,255,0.2)',
    padding: '2px 4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  starBtnActive: {
    color: '#f59e0b',
  },
  // File grid
  fileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '10px',
  },
  fileCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '18px 12px',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.02)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
    transition: 'all 0.12s',
  },
  fileCardSelected: {
    border: '1px solid rgba(99,102,241,0.4)',
    background: 'rgba(99,102,241,0.08)',
  },
  fileName: {
    fontSize: '13px',
    fontWeight: 500,
    wordBreak: 'break-word',
    lineHeight: 1.3,
  },
  fileMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  // File list
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '6px 14px',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: '4px',
  },
  listHeaderCell: {},
  fileListRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '9px 14px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    width: '100%',
    transition: 'background 0.1s',
  },
  fileListRowSelected: {
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '6px',
  },
  fileListName: {
    flex: 1,
    fontSize: '13px',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileListSize: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    width: '80px',
    textAlign: 'right',
  },
  fileListDate: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    width: '120px',
    textAlign: 'right',
  },
  // Context menu
  contextMenu: {
    position: 'fixed',
    zIndex: 100,
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding: '4px',
    minWidth: '140px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: '#e2e8f0',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  // Detail view
  detailCard: {
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.03)',
    padding: '24px',
    marginTop: '16px',
  },
  previewArea: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: '10px',
    padding: '16px',
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '400px',
    borderRadius: '8px',
    objectFit: 'contain',
  },
  detailMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
    color: '#e2e8f0',
  },
  detailLabel: {
    width: '80px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
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
  // Dialog
  dialogOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  dialogCard: {
    width: '100%',
    maxWidth: '420px',
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    padding: '28px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  dialogTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#e2e8f0',
    marginBottom: '4px',
  },
  dialogSubtitle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: '20px',
    wordBreak: 'break-all',
  },
  dialogField: {
    marginBottom: '16px',
  },
  dialogLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  dialogSelect: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  dialogInput: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '20px',
  },
  dialogCancelBtn: {
    padding: '9px 18px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dialogConfirmBtn: {
    padding: '9px 18px',
    border: 'none',
    borderRadius: '8px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  linkCopyRow: {
    display: 'flex',
    gap: '8px',
  },
  linkCopyInput: {
    flex: 1,
    padding: '9px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  linkCopyBtn: {
    padding: '9px 16px',
    border: 'none',
    borderRadius: '8px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  // States
  errorMsg: {
    padding: '12px 16px',
    borderRadius: '10px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    color: '#fca5a5',
    fontSize: '13px',
    marginBottom: '16px',
  },
  emptyMsg: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '14px',
    textAlign: 'center',
    padding: '48px 0',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 0',
  },
};
