const $ = (sel) => document.querySelector(sel);

let isPaused = false;

// ─── Update display ───

function updateStatus(status) {
  const dot = $('#status-dot');
  const text = $('#status-text');
  const sub = $('#status-sub');

  if (status.state === 'not_configured') {
    dot.className = 'status-dot paused';
    text.textContent = 'Not configured';
    sub.textContent = 'Click to set up';
    return;
  }

  const counts = status.counts || {};
  const pending = (counts.pending || 0) + (counts.syncing || 0);

  if (status.paused) {
    dot.className = 'status-dot paused';
    text.textContent = 'Paused';
    sub.textContent = '';
    isPaused = true;
    $('#pause-btn').textContent = 'Resume';
  } else if (pending > 0) {
    dot.className = 'status-dot syncing';
    text.textContent = `Syncing ${pending} file${pending !== 1 ? 's' : ''}...`;
    sub.textContent = status.currentFile || '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  } else if ((counts.error || 0) > 0) {
    dot.className = 'status-dot error';
    text.textContent = `${counts.error} file${counts.error !== 1 ? 's' : ''} failed`;
    sub.textContent = '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  } else {
    dot.className = 'status-dot idle';
    text.textContent = 'All files synced';
    sub.textContent = '';
    isPaused = false;
    $('#pause-btn').textContent = 'Pause';
  }

  // Update counts
  $('#count-synced').textContent = counts.synced || 0;
  $('#count-pending').textContent = counts.pending || 0;
  $('#count-syncing').textContent = counts.syncing || 0;
  $('#count-errors').textContent = counts.error || 0;

  // Update logs
  if (status.recentLogs) {
    const logList = $('#log-list');
    logList.innerHTML = '';
    for (const log of status.recentLogs) {
      const el = document.createElement('div');
      el.className = 'log-entry';
      const filename = log.rel_path ? log.rel_path.split('/').pop() : '';
      el.innerHTML = `<span class="log-action">${log.action}</span> ${filename}`;
      logList.appendChild(el);
    }
    if (status.recentLogs.length === 0) {
      logList.innerHTML = '<div class="log-entry" style="color:rgba(255,255,255,0.3)">No activity yet</div>';
    }
  }
}

// ─── Initial load ───

async function refresh() {
  const status = await window.mayday.getStatus();
  updateStatus(status);
}

refresh();

// Refresh every 3 seconds
setInterval(refresh, 3000);

// ─── Push updates from main process ───

window.mayday.onStatusUpdate((status) => {
  // Merge push update with a full refresh
  refresh();
});

// ─── Actions ───

$('#open-folder-btn').addEventListener('click', () => {
  window.mayday.openSyncFolder();
});

$('#pause-btn').addEventListener('click', async () => {
  if (isPaused) {
    await window.mayday.resume();
  } else {
    await window.mayday.pause();
  }
  // Refresh after a tick
  setTimeout(refresh, 500);
});

// ─── Mount Section ───

let mountBusy = false;
let cacheWarmActive = false;

function updateMountUI(status) {
  const dot = $('#mount-dot');
  const text = $('#mount-status-text');
  const btn = $('#mount-toggle-btn');

  const cacheRow = $('#cache-warm-row');

  switch (status.state) {
    case 'mounted':
      dot.className = 'status-dot idle';
      text.textContent = status.mountPoint || 'Mounted';
      btn.textContent = 'Unmount';
      btn.disabled = false;
      if (!cacheWarmActive) cacheRow.style.display = '';
      break;
    case 'starting':
      dot.className = 'status-dot syncing';
      text.textContent = 'Connecting...';
      btn.textContent = 'Unmount';
      btn.disabled = true;
      cacheRow.style.display = 'none';
      break;
    case 'error':
      dot.className = 'status-dot error';
      text.textContent = 'Mount error';
      btn.textContent = 'Retry';
      btn.disabled = false;
      cacheRow.style.display = 'none';
      break;
    default:
      dot.className = 'status-dot';
      dot.style.background = 'rgba(255,255,255,0.2)';
      text.textContent = 'Not mounted';
      btn.textContent = 'Mount';
      btn.disabled = false;
      cacheRow.style.display = 'none';
  }
}

async function refreshMount() {
  try {
    const status = await window.mayday.mountStatus();
    updateMountUI(status);
  } catch {
    // Mount API not available (older main process)
  }
}

async function checkMountDeps() {
  try {
    const deps = await window.mayday.mountCheckDeps();
    const warnings = [];
    if (!deps.rclone.installed) {
      const inst = deps.rclone.installInstructions;
      warnings.push('rclone not found. Install: ' + inst.methods.map(m => m.command || m.url).join(' or '));
    }
    if (!deps.fuse.installed) {
      const inst = deps.fuse.installInstructions || [{ url: deps.fuse.installUrl }];
      warnings.push('FUSE not found. Install: ' + inst.map(i => i.command || i.url).join(' or '));
    }
    const el = $('#mount-deps-warning');
    if (warnings.length > 0) {
      el.textContent = warnings.join('\n');
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
    return deps.rclone.installed && deps.fuse.installed;
  } catch {
    return false;
  }
}

$('#mount-toggle-btn').addEventListener('click', async () => {
  if (mountBusy) return;
  mountBusy = true;
  const btn = $('#mount-toggle-btn');
  btn.disabled = true;

  try {
    const status = await window.mayday.mountStatus();
    if (status.state === 'mounted' || status.state === 'starting') {
      await window.mayday.mountStop();
    } else {
      const depsOk = await checkMountDeps();
      if (!depsOk) {
        btn.disabled = false;
        mountBusy = false;
        return;
      }
      const result = await window.mayday.mountStart();
      if (!result.success) {
        $('#mount-status-text').textContent = result.error;
        $('#mount-dot').className = 'status-dot error';
      }
    }
  } finally {
    mountBusy = false;
    setTimeout(refreshMount, 500);
  }
});

// Listen for mount state changes pushed from main
if (window.mayday.onMountStateChange) {
  window.mayday.onMountStateChange((state) => {
    refreshMount();
    if (state !== 'mounted' && cacheWarmActive) {
      window.mayday.cacheStop();
      resetCacheWarmUI();
    }
  });
}

// Listen for mount auto-start failures
if (window.mayday.onMountAutoStartFailed) {
  window.mayday.onMountAutoStartFailed((error) => {
    const text = $('#mount-status-text');
    const dot = $('#mount-dot');
    if (text) text.textContent = error || 'Auto-start failed';
    if (dot) dot.className = 'status-dot error';
  });
}

// Listen for health check failures
if (window.mayday.onMountHealthCheckFailed) {
  window.mayday.onMountHealthCheckFailed((error) => {
    const text = $('#mount-status-text');
    const dot = $('#mount-dot');
    if (text) text.textContent = 'Connection lost';
    if (dot) dot.className = 'status-dot error';
  });
}

// Bug 7: Periodic mount status polling
setInterval(refreshMount, 5000);

// Initial mount status
refreshMount();

// ─── Cache Pre-Warm ───

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function resetCacheWarmUI() {
  cacheWarmActive = false;
  $('#cache-warm-progress').style.display = 'none';
  $('#cache-warm-bar').style.width = '0%';
  $('#cache-warm-text').textContent = 'Warming...';
  $('#cache-warm-cancel').style.display = '';
  // Let updateMountUI decide whether to show the button row
  // based on actual mount state (avoids flash when unmounting)
  refreshMount();
}

$('#cache-warm-btn').addEventListener('click', async () => {
  const folder = await window.mayday.cachePickFolder();
  if (!folder) return;

  cacheWarmActive = true;
  $('#cache-warm-row').style.display = 'none';
  $('#cache-warm-progress').style.display = '';
  $('#cache-warm-text').textContent = 'Scanning files...';
  $('#cache-warm-bar').style.width = '0%';

  const result = await window.mayday.cacheStart(folder);
  if (!result.success) {
    $('#cache-warm-text').textContent = result.error || 'Failed to start';
    setTimeout(resetCacheWarmUI, 3000);
  }
});

$('#cache-warm-cancel').addEventListener('click', async () => {
  await window.mayday.cacheStop();
  resetCacheWarmUI();
});

if (window.mayday.onCacheProgress) {
  window.mayday.onCacheProgress((data) => {
    const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    $('#cache-warm-bar').style.width = pct + '%';
    $('#cache-warm-text').textContent =
      `Warming ${data.current}/${data.total} files (${formatBytes(data.bytesWarmed)} / ${formatBytes(data.bytesTotal)})`;

    if (data.current >= data.total) {
      $('#cache-warm-text').textContent = 'Cache warmed!';
      $('#cache-warm-cancel').style.display = 'none';
      setTimeout(resetCacheWarmUI, 3000);
    }
  });
}

// ─── Update Footer ───

function updateUpdateUI(status) {
  const text = $('#update-text');
  const btn = $('#update-btn');
  const ver = status.currentVersion ? `v${status.currentVersion}` : '';

  // Reset classes
  text.className = 'update-text';
  btn.className = 'update-btn';
  btn.style.display = '';
  text.onclick = null;

  switch (status.state) {
    case 'checking':
      text.textContent = `${ver} \u00b7 Checking for updates\u2026`;
      btn.classList.add('spinning');
      btn.disabled = true;
      break;
    case 'available':
      text.textContent = `${ver} \u00b7 Update available` +
        (status.availableVersion ? ` (v${status.availableVersion})` : '');
      btn.disabled = false;
      break;
    case 'downloading':
      text.textContent = `Downloading update\u2026 ${status.progress || 0}%`;
      btn.classList.add('spinning');
      btn.disabled = true;
      break;
    case 'ready':
      text.textContent = 'Update ready \u2014 click to restart';
      text.classList.add('ready', 'clickable');
      text.onclick = () => window.mayday.installUpdate();
      btn.style.display = 'none';
      break;
    case 'error':
      text.textContent = `${ver} \u00b7 Update check failed`;
      btn.disabled = false;
      break;
    default:
      text.textContent = `${ver} \u00b7 Up to date`;
      btn.disabled = false;
      break;
  }
}

$('#update-btn').addEventListener('click', () => {
  window.mayday.checkForUpdate();
});

// Listen for push updates from main
if (window.mayday.onUpdateStatus) {
  window.mayday.onUpdateStatus((status) => updateUpdateUI(status));
}

// Initial fetch
async function refreshUpdate() {
  try {
    const status = await window.mayday.getUpdateStatus();
    if (status) updateUpdateUI(status);
  } catch {
    // update API not available
  }
}

refreshUpdate();
