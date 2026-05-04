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

function updateMountUI(status) {
  const dot = $('#mount-dot');
  const text = $('#mount-status-text');
  const btn = $('#mount-toggle-btn');

  switch (status.state) {
    case 'mounted':
      dot.className = 'status-dot idle';
      text.textContent = status.mountPoint || 'Mounted';
      btn.textContent = 'Unmount';
      btn.disabled = false;
      break;
    case 'starting':
      dot.className = 'status-dot syncing';
      text.textContent = 'Connecting...';
      btn.textContent = 'Unmount';
      btn.disabled = true;
      break;
    case 'error':
      dot.className = 'status-dot error';
      text.textContent = 'Mount error';
      btn.textContent = 'Retry';
      btn.disabled = false;
      break;
    default:
      dot.className = 'status-dot';
      dot.style.background = 'rgba(255,255,255,0.2)';
      text.textContent = 'Not mounted';
      btn.textContent = 'Mount';
      btn.disabled = false;
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
  window.mayday.onMountStateChange(() => refreshMount());
}

// Initial mount status
refreshMount();
